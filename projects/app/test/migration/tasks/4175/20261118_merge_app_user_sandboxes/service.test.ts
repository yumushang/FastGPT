import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  archiveSandboxResourceNow: vi.fn(),
  checkSandboxQuota: vi.fn(),
  claimTarget: vi.fn(),
  completeTarget: vi.fn(),
  createRestoreSandbox: vi.fn(),
  disconnectSandbox: vi.fn(),
  downloadWorkspaceArchive: vi.fn(),
  ensureUnzip: vi.fn(),
  findTarget: vi.fn(),
  mergeSessions: vi.fn(),
  readSources: vi.fn(),
  resolveTeamId: vi.fn(),
  restoreWorkspace: vi.fn(),
  stop: vi.fn(),
  touchTarget: vi.fn()
}));

vi.mock('@fastgpt/service/core/ai/sandbox/application/lease', () => ({
  withSandboxSourceMutationLease: async ({ fn }: any) => fn(),
  withSandboxLifecycleLease: async ({ fn }: any) =>
    fn({ assertValid: vi.fn(), signal: new AbortController().signal })
}));
vi.mock('@fastgpt/service/core/ai/sandbox/application/sourceGuard', () => ({
  resolveSandboxSourceTeamId: mocks.resolveTeamId
}));
vi.mock('@fastgpt/service/core/ai/sandbox/application/quota', () => ({
  checkSandboxQuota: mocks.checkSandboxQuota
}));
vi.mock('@fastgpt/service/core/ai/sandbox/infrastructure/provider/config', () => ({
  getConfiguredSandboxProvider: () => 'opensandbox'
}));
vi.mock('@fastgpt/service/core/ai/sandbox/application/archive', () => ({
  archiveSandboxResourceNow: mocks.archiveSandboxResourceNow,
  createRestoreSandbox: mocks.createRestoreSandbox,
  ensureUnzipAvailableInSandbox: mocks.ensureUnzip,
  mergeWorkspaceSessionsFromArchive: mocks.mergeSessions,
  restoreWorkspaceArchive: mocks.restoreWorkspace
}));
vi.mock('@fastgpt/service/core/ai/sandbox/infrastructure/provider/lifecycle', () => ({
  disconnectSandbox: mocks.disconnectSandbox
}));
vi.mock('@fastgpt/service/common/s3/sources/sandbox', () => ({
  getS3SandboxSource: () => ({ downloadWorkspaceArchive: mocks.downloadWorkspaceArchive })
}));
vi.mock('@fastgpt/service/core/ai/sandbox/config', () => ({
  getAgentSandboxArchiveMaxBytes: () => 1024
}));
vi.mock('@fastgpt/service/core/ai/sandbox/infrastructure/volume/service', () => ({
  getSessionVolumeClaimName: () => 'volume-1'
}));
vi.mock('@/migration/tasks/4175/20261118_merge_app_user_sandboxes/entity', () => ({
  claimAppSandboxMigrationTarget: mocks.claimTarget,
  completeAppSandboxMigrationTarget: mocks.completeTarget,
  findAppSandboxMigrationTarget: mocks.findTarget,
  readAppSandboxMigrationSources: mocks.readSources,
  touchAppSandboxMigrationTarget: mocks.touchTarget
}));

import { mergeAppUserSandboxes } from '@/migration/tasks/4175/20261118_merge_app_user_sandboxes/service';

const target = {
  _id: 'target-id',
  provider: 'opensandbox',
  sandboxId: 'app-shared',
  status: 'legacyMigrating',
  operation: { id: 'operation-1' },
  storage: { volumes: [{ name: 'workspace', claimName: 'volume-1' }] }
};
const sources = [
  { sandboxId: 'app-user-1', status: 'running' },
  { sandboxId: 'app-user-2', status: 'archived' }
];

describe('mergeAppUserSandboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTeamId.mockResolvedValue('team-1');
    mocks.findTarget.mockResolvedValue(null);
    mocks.claimTarget.mockResolvedValue({ resource: target, hadArchive: false });
    mocks.readSources.mockResolvedValue(sources);
    mocks.archiveSandboxResourceNow.mockImplementation(async (resource) => ({
      status: 'success',
      resource: { ...resource, status: 'archived' }
    }));
    mocks.createRestoreSandbox.mockResolvedValue({
      sandbox: { stop: mocks.stop },
      profile: { workDirectory: '/workspace' }
    });
    mocks.downloadWorkspaceArchive.mockResolvedValue(Buffer.from('archive'));
    mocks.disconnectSandbox.mockResolvedValue(undefined);
    mocks.completeTarget.mockResolvedValue({ ...target, status: 'stopped' });
  });

  it('archives and merges every source before stopping and publishing the target', async () => {
    await expect(mergeAppUserSandboxes('app-1')).resolves.toEqual({ sourceCount: 2 });

    expect(mocks.checkSandboxQuota).toHaveBeenCalledWith({ teamId: 'team-1', current: null });
    expect(mocks.restoreWorkspace).not.toHaveBeenCalled();
    expect(mocks.archiveSandboxResourceNow).toHaveBeenCalledTimes(2);
    expect(mocks.mergeSessions).toHaveBeenCalledTimes(2);
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeTarget.mock.invocationCallOrder[0]
    );
    expect(mocks.disconnectSandbox).toHaveBeenCalled();
  });

  it('archives an existing target and restores its workspace before merging sources', async () => {
    mocks.findTarget.mockResolvedValue({ ...target, status: 'running' });
    mocks.claimTarget.mockResolvedValue({ resource: target, hadArchive: true });

    await mergeAppUserSandboxes('app-1');

    expect(mocks.archiveSandboxResourceNow).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' })
    );
    expect(mocks.checkSandboxQuota).not.toHaveBeenCalled();
    expect(mocks.restoreWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'app-shared' })
    );
  });

  it('keeps the target behind its migration barrier when a source cannot be archived', async () => {
    mocks.archiveSandboxResourceNow.mockResolvedValueOnce({ status: 'failed', error: 'busy' });

    await expect(mergeAppUserSandboxes('app-1')).rejects.toThrow('Failed to archive source');
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.completeTarget).not.toHaveBeenCalled();
    expect(mocks.disconnectSandbox).toHaveBeenCalled();
  });
});
