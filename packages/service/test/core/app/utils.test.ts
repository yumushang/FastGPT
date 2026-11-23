import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPreview = vi.fn();
vi.mock('@fastgpt/service/core/app/tool/controller', () => ({
  getChildAppPreviewNode: (...args: any[]) => mockPreview(...args)
}));
vi.mock('@fastgpt/service/support/permission/app/auth', () => ({
  authAppByTmbId: vi.fn(async () => ({}))
}));
vi.mock('@fastgpt/service/core/dataset/schema', () => ({
  MongoDataset: { find: vi.fn(() => ({ lean: vi.fn().mockResolvedValue([]) })) }
}));
vi.mock('@fastgpt/service/core/ai/model', () => ({
  getEmbeddingModel: vi.fn(() => ({ model: 'emb' }))
}));

import { rewriteAppWorkflowToDetail } from '@fastgpt/service/core/app/utils';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';

const previewInputs = () => [
  { key: 'userChatInput', valueType: 'string', value: '', label: 'q' },
  { key: 'directOutput', valueType: 'boolean', value: false, label: 'd' },
  { key: 'visibleToMain', valueType: 'boolean', value: false, label: 'v' }
];

const makeStoreNode = (inputs: any[], version = '') =>
  ({
    nodeId: 'app1',
    flowNodeType: FlowNodeTypeEnum.appModule,
    pluginId: '68ad85a7463006c963799a05',
    version,
    name: 'child',
    inputs,
    outputs: []
  }) as any;

beforeEach(() => {
  mockPreview.mockReset();
  mockPreview.mockImplementation(async ({ versionId }: any) => ({
    inputs: previewInputs(),
    outputs: [],
    toolDescription: 'child desc',
    version: versionId ?? ''
  }));
});

describe('rewriteAppWorkflowToDetail hook switch persistence', () => {
  it('latest version: preview hook keys appear with default false when store lacks them', async () => {
    const nodes = [makeStoreNode([{ key: 'userChatInput', value: 'hello' }])];
    await rewriteAppWorkflowToDetail({ nodes, teamId: 't1', ownerTmbId: 'm1' } as any);
    const inputs = nodes[0].inputs;
    expect(inputs.find((i: any) => i.key === 'visibleToMain')?.value).toBe(false);
    expect(inputs.find((i: any) => i.key === 'directOutput')?.value).toBe(false);
    expect(inputs.find((i: any) => i.key === 'userChatInput')?.value).toBe('hello');
  });

  it('latest version: stored switch values survive preview overwrite', async () => {
    const nodes = [
      makeStoreNode([
        { key: 'userChatInput', value: 'hello' },
        { key: 'visibleToMain', value: true },
        { key: 'directOutput', value: true }
      ])
    ];
    await rewriteAppWorkflowToDetail({ nodes, teamId: 't1', ownerTmbId: 'm1' } as any);
    const inputs = nodes[0].inputs;
    expect(inputs.find((i: any) => i.key === 'visibleToMain')?.value).toBe(true);
    expect(inputs.find((i: any) => i.key === 'directOutput')?.value).toBe(true);
  });

  it('fixed version: inputs untouched', async () => {
    const storeInputs = [{ key: 'userChatInput', value: 'hello' }];
    const nodes = [makeStoreNode(storeInputs, 'v1')];
    await rewriteAppWorkflowToDetail({ nodes, teamId: 't1', ownerTmbId: 'm1' } as any);
    expect(nodes[0].inputs.find((i: any) => i.key === 'visibleToMain')).toBeUndefined();
    expect(nodes[0].inputs[0].value).toBe('hello');
  });
});
