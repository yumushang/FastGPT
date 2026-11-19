import { z } from 'zod';
import { SystemMigrationStatusEnum } from '@fastgpt/global/migration/constants';
import type { SystemMigrationFailedRecord } from '@fastgpt/global/migration/schema';
import { getErrText } from '@fastgpt/global/common/error/utils';
import type { SystemMigrationContext } from '@/migration/registry';
import { systemMigrationBatchSize } from '@/migration/constants';
import { mergeAppUserSandboxes } from './service';
import { findAppSandboxMigrationTarget, readAppSandboxMigrationSourceIds } from './entity';

const CheckpointSchema = z.object({
  version: z.literal(1),
  lastSourceId: z.string().nullable(),
  processedAppCount: z.number().int().nonnegative(),
  mergedSourceCount: z.number().int().nonnegative()
});

/**
 * 按 App 稳定游标归并用户级 Sandbox。单个 App 失败会保留错误并继续其他 App；
 * 重试优先处理失败记录，业务提交和错误快照保存后才推进 checkpoint。
 */
export const mergeAppUserSandboxMigration = async (context: SystemMigrationContext) => {
  let checkpoint = (await context.getCheckpoint(CheckpointSchema)) ?? {
    version: 1 as const,
    lastSourceId: null,
    processedAppCount: 0,
    mergedSourceCount: 0
  };
  const failedApps = new Map<string, SystemMigrationFailedRecord>(
    (await context.getFailedRecords()).map((record) => [String(record.data.sourceId), record])
  );

  await context.reportProgress({ key: 'applications', status: SystemMigrationStatusEnum.running });
  await context.reportProgress({ key: 'workspaces', status: SystemMigrationStatusEnum.running });

  const mergeOne = async (sourceId: string, stageKey: 'applications' | 'validation') => {
    try {
      const result = await mergeAppUserSandboxes(sourceId);
      failedApps.delete(sourceId);
      checkpoint = {
        ...checkpoint,
        processedAppCount: checkpoint.processedAppCount + 1,
        mergedSourceCount: checkpoint.mergedSourceCount + result.sourceCount
      };
      return result.sourceCount;
    } catch (error) {
      failedApps.set(sourceId, {
        stageKey,
        data: { sourceId },
        reason: { message: getErrText(error) }
      });
      return 0;
    }
  };

  // 管理员重试时先修复上次失败的 App，再推进主游标。
  for (const sourceId of [...failedApps.keys()]) {
    await context.assertActive();
    await mergeOne(sourceId, 'applications');
    await context.reportFailedRecords([...failedApps.values()]);
    await context.saveCheckpoint(checkpoint);
  }

  for (;;) {
    context.signal.throwIfAborted();
    await context.assertActive();
    const sourceIds = await readAppSandboxMigrationSourceIds({
      lastSourceId: checkpoint.lastSourceId ?? undefined,
      limit: systemMigrationBatchSize
    });
    if (sourceIds.length === 0) break;

    for (const sourceId of sourceIds) {
      context.signal.throwIfAborted();
      await context.assertActive();
      await mergeOne(sourceId, 'applications');
      checkpoint = { ...checkpoint, lastSourceId: sourceId };
      await context.reportFailedRecords([...failedApps.values()]);
      await context.saveCheckpoint(checkpoint);
      await context.reportProgress({
        key: 'applications',
        status: SystemMigrationStatusEnum.running,
        current: checkpoint.processedAppCount
      });
      await context.reportProgress({
        key: 'workspaces',
        status: SystemMigrationStatusEnum.running,
        current: checkpoint.mergedSourceCount
      });
    }
  }

  await context.reportProgress({
    key: 'applications',
    status: SystemMigrationStatusEnum.succeeded
  });
  await context.reportProgress({ key: 'workspaces', status: SystemMigrationStatusEnum.succeeded });
  await context.reportProgress({ key: 'validation', status: SystemMigrationStatusEnum.running });

  // 全量只读校验目标已离开安装屏障；遗漏目标仍按 App 记录可定位错误。
  let validationSourceId: string | undefined;
  for (;;) {
    const sourceIds = await readAppSandboxMigrationSourceIds({
      lastSourceId: validationSourceId,
      limit: systemMigrationBatchSize
    });
    if (sourceIds.length === 0) break;

    for (const sourceId of sourceIds) {
      await context.assertActive();
      const target = await findAppSandboxMigrationTarget(sourceId);
      if (!target || target.status === 'legacyMigrating') {
        failedApps.set(sourceId, {
          stageKey: 'validation',
          data: { sourceId, sandboxId: target?.sandboxId ?? null },
          reason: {
            message: target ? 'Shared sandbox is still migrating' : 'Shared sandbox is missing'
          }
        });
      } else if (!failedApps.has(sourceId)) {
        failedApps.delete(sourceId);
      }
      validationSourceId = sourceId;
    }
  }
  await context.reportFailedRecords([...failedApps.values()]);
  if (failedApps.size > 0) {
    await context.fail({
      message: `${failedApps.size} apps failed to merge user sandboxes`,
      failedRecords: [...failedApps.values()]
    });
  }

  await context.reportProgress({ key: 'validation', status: SystemMigrationStatusEnum.succeeded });
  return {
    processedAppCount: checkpoint.processedAppCount,
    mergedSourceCount: checkpoint.mergedSourceCount
  };
};
