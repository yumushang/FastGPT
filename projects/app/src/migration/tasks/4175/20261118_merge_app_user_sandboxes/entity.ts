import { randomUUID } from 'node:crypto';
import { ChatSourceTypeEnum } from '@fastgpt/global/core/chat/constants';
import { APP_SHARED_SANDBOX_USER_ID } from '@fastgpt/global/core/ai/sandbox/constants';
import { getRunningSandboxId } from '@fastgpt/service/core/ai/sandbox/utils/id';
import { MongoSandboxInstance } from '@fastgpt/service/core/ai/sandbox/infrastructure/instance/schema';
import type { SandboxResourceDoc } from '@fastgpt/service/core/ai/sandbox/infrastructure/instance/repository';
import type { SandboxProviderType } from '@fastgpt/service/core/ai/sandbox/type';
import {
  buildVolumeConfig,
  createSessionVolumeClaimName
} from '@fastgpt/service/core/ai/sandbox/infrastructure/volume/service';

export const readAppSandboxMigrationSourceIds = async ({
  lastSourceId,
  limit
}: {
  lastSourceId?: string;
  limit: number;
}) => {
  const rows = await MongoSandboxInstance.aggregate<{ _id: string }>([
    {
      $match: {
        sourceType: ChatSourceTypeEnum.app,
        userId: { $ne: APP_SHARED_SANDBOX_USER_ID },
        ...(lastSourceId ? { sourceId: { $gt: lastSourceId } } : {})
      }
    },
    { $group: { _id: '$sourceId' } },
    { $sort: { _id: 1 } },
    { $limit: limit }
  ]);
  return rows.map(({ _id }) => _id);
};

/** 新 Workspace 优先安装，后续旧归档只补缺文件。 */
export const readAppSandboxMigrationSources = (sourceId: string) =>
  MongoSandboxInstance.find({
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    userId: { $ne: APP_SHARED_SANDBOX_USER_ID }
  })
    .sort({ lastActiveAt: -1, _id: -1 })
    .lean<SandboxResourceDoc[]>();

export const findAppSandboxMigrationTarget = (sourceId: string) => {
  const sandboxId = getRunningSandboxId({
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    userId: APP_SHARED_SANDBOX_USER_ID
  });
  return MongoSandboxInstance.findOne({ sandboxId }).lean<SandboxResourceDoc | null>();
};

/** 创建或接管目标安装屏障；previousStatus 记录重试时是否需要先恢复目标原归档。 */
export async function claimAppSandboxMigrationTarget({
  sourceId,
  provider,
  teamId
}: {
  sourceId: string;
  provider: SandboxProviderType;
  teamId: string;
}) {
  const sandboxId = getRunningSandboxId({
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    userId: APP_SHARED_SANDBOX_USER_ID
  });
  const current = await MongoSandboxInstance.findOne({
    sandboxId
  }).lean<SandboxResourceDoc | null>();
  if (current && current.status !== 'archived' && current.status !== 'legacyMigrating') {
    throw new Error(`Shared sandbox target is ${current.status}; archive it before migration`);
  }

  const now = new Date();
  const operation = {
    id: current?.operation?.id ?? randomUUID(),
    type: 'legacyMigration' as const,
    phase: current?.operation?.phase ?? 'claimed',
    previousStatus:
      current?.operation?.previousStatus ??
      (current?.status === 'archived' ? ('archived' as const) : undefined),
    startedAt: current?.operation?.startedAt ?? now,
    heartbeatAt: now
  };
  const hadArchive = current?.status === 'archived' || operation.previousStatus === 'archived';
  const set = {
    provider,
    sandboxId,
    sourceType: ChatSourceTypeEnum.app,
    sourceId,
    userId: APP_SHARED_SANDBOX_USER_ID,
    status: 'legacyMigrating' as const,
    lastActiveAt: now,
    teamId,
    operation,
    ...(provider === 'opensandbox' && !current?.storage
      ? {
          storage: buildVolumeConfig(createSessionVolumeClaimName({ sandboxId, generationId: '0' }))
            .storage
        }
      : {})
  };

  if (current) {
    const updated = await MongoSandboxInstance.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: set },
      { new: true }
    ).lean<SandboxResourceDoc | null>();
    if (!updated) throw new Error('Shared sandbox target changed while claiming migration');
    return { resource: updated, hadArchive };
  }

  const created = await MongoSandboxInstance.create({ ...set, createdAt: now });
  return { resource: created.toObject() as SandboxResourceDoc, hadArchive };
}

export const touchAppSandboxMigrationTarget = (target: SandboxResourceDoc) =>
  MongoSandboxInstance.updateOne(
    { _id: target._id, status: 'legacyMigrating', 'operation.id': target.operation?.id },
    { $set: { 'operation.heartbeatAt': new Date() } }
  );

/** 只有 Provider 已停止的调用方才允许发布 stopped，并清除安装屏障。 */
export const completeAppSandboxMigrationTarget = (target: SandboxResourceDoc) =>
  MongoSandboxInstance.findOneAndUpdate(
    { _id: target._id, status: 'legacyMigrating', 'operation.id': target.operation?.id },
    {
      $set: { status: 'stopped', lastActiveAt: new Date() },
      $unset: { operation: 1 }
    },
    { new: true }
  ).lean<SandboxResourceDoc | null>();
