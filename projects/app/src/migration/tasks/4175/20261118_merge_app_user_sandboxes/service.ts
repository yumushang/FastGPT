import type { ISandbox } from '@fastgpt-sdk/sandbox-adapter';
import { ChatSourceTypeEnum } from '@fastgpt/global/core/chat/constants';
import { APP_SHARED_SANDBOX_USER_ID } from '@fastgpt/global/core/ai/sandbox/constants';
import { getRunningSandboxId } from '@fastgpt/service/core/ai/sandbox/utils/id';
import { getConfiguredSandboxProvider } from '@fastgpt/service/core/ai/sandbox/infrastructure/provider/config';
import { resolveSandboxSourceTeamId } from '@fastgpt/service/core/ai/sandbox/application/sourceGuard';
import { checkSandboxQuota } from '@fastgpt/service/core/ai/sandbox/application/quota';
import {
  withSandboxLifecycleLease,
  withSandboxSourceMutationLease
} from '@fastgpt/service/core/ai/sandbox/application/lease';
import {
  archiveSandboxResourceNow,
  createRestoreSandbox,
  ensureUnzipAvailableInSandbox,
  mergeWorkspaceSessionsFromArchive,
  restoreWorkspaceArchive
} from '@fastgpt/service/core/ai/sandbox/application/archive';
import { disconnectSandbox } from '@fastgpt/service/core/ai/sandbox/infrastructure/provider/lifecycle';
import { getS3SandboxSource } from '@fastgpt/service/common/s3/sources/sandbox';
import { getAgentSandboxArchiveMaxBytes } from '@fastgpt/service/core/ai/sandbox/config';
import { getSessionVolumeClaimName } from '@fastgpt/service/core/ai/sandbox/infrastructure/volume/service';
import {
  claimAppSandboxMigrationTarget,
  completeAppSandboxMigrationTarget,
  findAppSandboxMigrationTarget,
  readAppSandboxMigrationSources,
  touchAppSandboxMigrationTarget
} from './entity';

/**
 * 归并单个 App 的用户级 Workspace。目标在全部源安装成功并停止前一直保持迁移屏障；
 * 源记录与 S3 归档不删除，重试只重放目标内容优先的幂等合并。
 */
export const mergeAppUserSandboxes = async (sourceId: string) => {
  const sandboxId = getRunningSandboxId({
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    userId: APP_SHARED_SANDBOX_USER_ID
  });

  return withSandboxSourceMutationLease({
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    label: `merge-app-sandbox:${sourceId}`,
    fn: async () => {
      const teamId = await resolveSandboxSourceTeamId({
        sourceType: ChatSourceTypeEnum.app,
        sourceId
      });
      if (!teamId) throw new Error(`App ${sourceId} has no teamId`);

      // 已提前创建的共享目标先保存现状，避免覆盖迁移前产生的新 Session。
      const existing = await findAppSandboxMigrationTarget(sourceId);
      if (existing?.status === 'running' || existing?.status === 'stopped') {
        const archived = await archiveSandboxResourceNow(existing);
        if (archived.status !== 'success') {
          throw new Error(`Failed to archive shared target: ${JSON.stringify(archived)}`);
        }
      } else if (
        existing &&
        existing.status !== 'archived' &&
        existing.status !== 'legacyMigrating'
      ) {
        throw new Error(`Shared sandbox target cannot be migrated from ${existing.status}`);
      }
      if (!existing) await checkSandboxQuota({ teamId, current: null });

      return withSandboxLifecycleLease({
        sandboxId,
        label: `merge-app-sandbox-target:${sourceId}`,
        fn: async (lease) => {
          const { resource: target, hadArchive } = await claimAppSandboxMigrationTarget({
            sourceId,
            provider: getConfiguredSandboxProvider(),
            teamId
          });
          let sandbox: ISandbox | undefined;

          try {
            const restored = await createRestoreSandbox({
              provider: target.provider,
              sandboxId: target.sandboxId,
              claimName: getSessionVolumeClaimName(target.storage),
              assertValid: () => lease.assertValid()
            });
            sandbox = restored.sandbox;
            lease.assertValid();
            await ensureUnzipAvailableInSandbox(sandbox, lease.signal);

            // 只有原目标已有归档才先恢复；新目标直接从空 Workspace 开始。
            if (hadArchive) {
              const body = await getS3SandboxSource().downloadWorkspaceArchive({
                sandboxId: target.sandboxId,
                maxBytes: getAgentSandboxArchiveMaxBytes()
              });
              lease.assertValid();
              await restoreWorkspaceArchive({
                sandbox,
                workDirectory: restored.profile.workDirectory,
                sandboxId: target.sandboxId,
                archiveBody: body,
                assertValid: () => lease.assertValid(),
                signal: lease.signal
              });
            }

            const sources = await readAppSandboxMigrationSources(sourceId);
            for (const source of sources) {
              lease.assertValid();
              const archived = await archiveSandboxResourceNow(source);
              if (archived.status !== 'success') {
                throw new Error(
                  `Failed to archive source ${source.sandboxId}: ${JSON.stringify(archived)}`
                );
              }

              const body = await getS3SandboxSource().downloadWorkspaceArchive({
                sandboxId: source.sandboxId,
                maxBytes: getAgentSandboxArchiveMaxBytes()
              });
              lease.assertValid();
              await mergeWorkspaceSessionsFromArchive({
                sandbox,
                workDirectory: restored.profile.workDirectory,
                sourceSandboxId: source.sandboxId,
                archiveBody: body,
                assertValid: () => lease.assertValid(),
                signal: lease.signal
              });
              await touchAppSandboxMigrationTarget(target);
            }

            // Provider 停止成功后才解除迁移屏障，失败时正常运行态仍不能连接半成品。
            lease.assertValid();
            await sandbox.stop();
            const completed = await completeAppSandboxMigrationTarget(target);
            if (!completed) throw new Error('Failed to publish merged shared sandbox');
            return { sourceCount: sources.length };
          } finally {
            if (sandbox) await disconnectSandbox(sandbox).catch(() => undefined);
          }
        }
      });
    }
  });
};
