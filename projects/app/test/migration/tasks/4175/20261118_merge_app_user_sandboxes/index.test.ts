import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findTarget: vi.fn(),
  mergeApp: vi.fn(),
  readSourceIds: vi.fn()
}));

vi.mock('@/migration/tasks/4175/20261118_merge_app_user_sandboxes/service', () => ({
  mergeAppUserSandboxes: mocks.mergeApp
}));
vi.mock('@/migration/tasks/4175/20261118_merge_app_user_sandboxes/entity', () => ({
  findAppSandboxMigrationTarget: mocks.findTarget,
  readAppSandboxMigrationSourceIds: mocks.readSourceIds
}));

import { mergeAppUserSandboxMigration } from '@/migration/tasks/4175/20261118_merge_app_user_sandboxes';

const createContext = () => {
  const context = {
    migrationId: '20261118_merge_app_user_sandboxes',
    runId: 'run-1',
    signal: new AbortController().signal,
    getCheckpoint: vi.fn(async () => undefined),
    getFailedRecords: vi.fn(async () => []),
    reportFailedRecords: vi.fn(async () => undefined),
    saveCheckpoint: vi.fn(async () => undefined),
    reportProgress: vi.fn(async () => undefined),
    assertActive: vi.fn(async () => undefined),
    fail: vi.fn(async (error) => {
      throw new Error(error.message);
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
  return context;
};

describe('mergeAppUserSandboxMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSourceIds.mockImplementation(async ({ lastSourceId }) =>
      lastSourceId ? [] : ['app-1', 'app-2']
    );
    mocks.mergeApp.mockResolvedValue({ sourceCount: 2 });
    mocks.findTarget.mockResolvedValue({ sandboxId: 'shared', status: 'stopped' });
  });

  it('processes stable App batches and validates every shared target', async () => {
    const context = createContext();

    await expect(mergeAppUserSandboxMigration(context as any)).resolves.toEqual({
      processedAppCount: 2,
      mergedSourceCount: 4
    });
    expect(mocks.mergeApp).toHaveBeenCalledTimes(2);
    expect(context.reportProgress).toHaveBeenCalledWith({
      key: 'validation',
      status: 'succeeded'
    });
    expect(context.fail).not.toHaveBeenCalled();
  });

  it('keeps failed Apps in the complete error snapshot and does not report success', async () => {
    const context = createContext();
    mocks.mergeApp.mockImplementation(async (sourceId) => {
      if (sourceId === 'app-1') throw new Error('archive failed');
      return { sourceCount: 2 };
    });

    await expect(mergeAppUserSandboxMigration(context as any)).rejects.toThrow(
      '1 apps failed to merge user sandboxes'
    );
    expect(context.reportFailedRecords).toHaveBeenLastCalledWith([
      expect.objectContaining({
        data: { sourceId: 'app-1' },
        reason: { message: 'archive failed' }
      })
    ]);
    expect(context.reportProgress).not.toHaveBeenCalledWith({
      key: 'validation',
      status: 'succeeded'
    });
  });
});
