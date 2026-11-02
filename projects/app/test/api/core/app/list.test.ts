import * as listApi from '@/pages/api/core/app/list';
import type { ListAppBody } from '@/pages/api/core/app/list';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import type { AppListItemType } from '@fastgpt/global/core/app/type';
import { NodeInputKeyEnum, VariableInputEnum } from '@fastgpt/global/core/workflow/constants';
import {
  FlowNodeInputTypeEnum,
  FlowNodeTypeEnum
} from '@fastgpt/global/core/workflow/node/constant';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import {
  PerResourceTypeEnum,
  ReadPermissionVal
} from '@fastgpt/global/support/permission/constant';
import { getFakeUsers } from '@test/datas/users';
import type { parseHeaderCertRet } from '@test/mocks/request';
import { Call } from '@test/utils/request';
import { describe, expect, it } from 'vitest';

type AuthType = parseHeaderCertRet;

const createApp = async ({
  auth,
  name,
  type = AppTypeEnum.simple,
  modules = [],
  chatConfig,
  parentId
}: {
  auth: AuthType;
  name: string;
  type?: AppTypeEnum;
  modules?: any[];
  chatConfig?: any;
  parentId?: string;
}): Promise<string> => {
  const app = await MongoApp.create({
    teamId: auth.teamId,
    tmbId: auth.tmbId,
    name,
    type,
    modules,
    chatConfig,
    parentId: parentId ?? null
  } as any);

  return String(app._id);
};

const listApps = async (auth: AuthType, body: ListAppBody): Promise<AppListItemType[]> => {
  const res = await Call<ListAppBody, {}, AppListItemType[]>(listApi.default, {
    auth,
    body
  });
  expect(res.error).toBeUndefined();
  expect(res.code).toBe(200);

  return res.data;
};

const listAppIds = async (auth: AuthType, body: ListAppBody): Promise<string[]> => {
  const list = await listApps(auth, body);

  return list.map((item) => String(item._id)).sort();
};

const createNode = (params: {
  flowNodeType: FlowNodeTypeEnum;
  inputs: { key: string; value: any }[];
}) => params;

describe('app list api: filter by modelId', () => {
  it('should match flat model input of workflow node', async () => {
    const { owner } = await getFakeUsers(1);

    const matchedAppId = await createApp({
      auth: owner,
      name: 'flat-model-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'gpt-4o' }]
        })
      ]
    });
    const otherAppId = await createApp({
      auth: owner,
      name: 'other-model-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'gpt-4o-mini' }]
        })
      ]
    });

    expect(await listAppIds(owner, { modelId: 'gpt-4o' })).toEqual([matchedAppId]);

    const otherList = await listAppIds(owner, { modelId: 'gpt-4o-mini' });
    expect(otherList).toEqual([otherAppId]);
    expect(otherList).not.toContain(matchedAppId);
  });

  it('should match rerankModel and datasetSearchExtensionModel inside agent_datasetParams', async () => {
    const { owner } = await getFakeUsers(1);

    const appId = await createApp({
      auth: owner,
      name: 'agent-dataset-params-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.agent,
          inputs: [
            {
              key: NodeInputKeyEnum.datasetParams,
              value: {
                datasets: [],
                rerankModel: 'rerank-model',
                usingReRank: true,
                datasetSearchExtensionModel: 'extension-model',
                datasetSearchUsingExtensionQuery: true
              }
            }
          ]
        })
      ]
    });

    expect(await listAppIds(owner, { modelId: 'rerank-model' })).toEqual([appId]);
    expect(await listAppIds(owner, { modelId: 'extension-model' })).toEqual([appId]);
  });

  it('should match model inside old systemConfig node (tts / questionGuide value.model)', async () => {
    const { owner } = await getFakeUsers(1);

    const appId = await createApp({
      auth: owner,
      name: 'old-system-config-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.systemConfig,
          inputs: [
            {
              key: NodeInputKeyEnum.tts,
              value: { type: 'model', model: 'legacy-tts-model', voice: 'alloy' }
            },
            {
              key: NodeInputKeyEnum.questionGuide,
              value: { open: true, model: 'legacy-question-guide-model' }
            }
          ]
        })
      ]
    });

    expect(await listAppIds(owner, { modelId: 'legacy-tts-model' })).toEqual([appId]);
    expect(await listAppIds(owner, { modelId: 'legacy-question-guide-model' })).toEqual([appId]);
  });

  it('should match model inside chatConfig (ttsConfig / questionGuide)', async () => {
    const { owner } = await getFakeUsers(1);

    const appId = await createApp({
      auth: owner,
      name: 'chat-config-model-app',
      chatConfig: {
        ttsConfig: { type: 'model', model: 'chat-config-tts-model', voice: 'alloy' },
        questionGuide: { open: true, model: 'chat-config-question-guide-model' }
      }
    });

    expect(await listAppIds(owner, { modelId: 'chat-config-tts-model' })).toEqual([appId]);
    expect(await listAppIds(owner, { modelId: 'chat-config-question-guide-model' })).toEqual([
      appId
    ]);
  });

  it('should match custom model input, form input default value and llmSelect variable', async () => {
    const { owner } = await getFakeUsers(1);

    const customInputAppId = await createApp({
      auth: owner,
      name: 'custom-model-input-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [
            {
              key: 'customModel',
              renderTypeList: [FlowNodeInputTypeEnum.selectLLMModel],
              value: 'custom-input-model'
            }
          ]
        })
      ]
    });
    const customInputDefaultValueAppId = await createApp({
      auth: owner,
      name: 'custom-model-input-default-value-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [
            {
              key: 'customModelDefaultValue',
              renderTypeList: [FlowNodeInputTypeEnum.selectLLMModel],
              defaultValue: 'custom-input-default-model'
            }
          ]
        })
      ]
    });
    const formInputAppId = await createApp({
      auth: owner,
      name: 'form-input-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.formInput,
          inputs: [
            {
              key: NodeInputKeyEnum.userInputForms,
              value: [
                {
                  type: FlowNodeInputTypeEnum.selectLLMModel,
                  key: 'formModel',
                  label: 'form model',
                  valueType: 'string',
                  required: false,
                  defaultValue: 'form-input-model'
                }
              ]
            }
          ]
        })
      ]
    });
    const variableAppId = await createApp({
      auth: owner,
      name: 'llm-select-variable-app',
      chatConfig: {
        variables: [
          {
            key: 'variableModel',
            type: VariableInputEnum.llmSelect,
            defaultValue: 'variable-model'
          },
          {
            key: 'plainVariable',
            type: VariableInputEnum.input,
            defaultValue: 'plain-variable-value'
          }
        ]
      }
    });

    expect(await listAppIds(owner, { modelId: 'custom-input-model' })).toEqual([customInputAppId]);
    expect(await listAppIds(owner, { modelId: 'custom-input-default-model' })).toEqual([
      customInputDefaultValueAppId
    ]);
    expect(await listAppIds(owner, { modelId: 'form-input-model' })).toEqual([formInputAppId]);
    expect(await listAppIds(owner, { modelId: 'variable-model' })).toEqual([variableAppId]);

    // Non model typed input / variable should not be treated as a model usage
    expect(await listAppIds(owner, { modelId: 'plain-variable-value' })).toEqual([]);
  });

  it('should not return apps that do not use the model', async () => {
    const { owner } = await getFakeUsers(1);

    const usedAppId = await createApp({
      auth: owner,
      name: 'used-model-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'used-model' }]
        })
      ]
    });
    await createApp({
      auth: owner,
      name: 'unused-model-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'another-model' }]
        })
      ]
    });

    expect(await listAppIds(owner, { modelId: 'not-exists-model' })).toEqual([]);
    expect(await listAppIds(owner, { modelId: 'used-model' })).toEqual([usedAppId]);
  });

  it('should find apps in sub folders when filter by modelId', async () => {
    const { owner } = await getFakeUsers(1);

    const folderId = await createApp({
      auth: owner,
      name: 'test-folder',
      type: AppTypeEnum.folder
    });
    const nestedAppId = await createApp({
      auth: owner,
      name: 'nested-model-app',
      parentId: folderId,
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'nested-model' }]
        })
      ]
    });
    const rootAppId = await createApp({
      auth: owner,
      name: 'root-model-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'nested-model' }]
        })
      ]
    });

    const modelList = await listAppIds(owner, { modelId: 'nested-model' });
    expect(modelList).toContain(nestedAppId);
    expect(modelList).toContain(rootAppId);

    // Without modelId, the list still only returns the current folder (root) apps
    const rootList = await listAppIds(owner, {});
    expect(rootList).toContain(rootAppId);
    expect(rootList).not.toContain(nestedAppId);
  });

  it('should list apps in folder for team owner', async () => {
    const { owner } = await getFakeUsers(1);

    const folderId = await createApp({
      auth: owner,
      name: 'owner-folder',
      type: AppTypeEnum.folder
    });
    const childAppId = await createApp({
      auth: owner,
      name: 'owner-folder-app',
      parentId: folderId
    });

    expect(await listAppIds(owner, { parentId: folderId })).toEqual([childAppId]);
  });

  it('should apply searchKey and modelId at the same time', async () => {
    const { owner } = await getFakeUsers(1);

    const alphaSharedModelAppId = await createApp({
      auth: owner,
      name: 'alpha-report',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'shared-model' }]
        })
      ]
    });
    const betaSharedModelAppId = await createApp({
      auth: owner,
      name: 'beta-report',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'shared-model' }]
        })
      ]
    });
    const alphaOtherModelAppId = await createApp({
      auth: owner,
      name: 'alpha-doc',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'another-model' }]
        })
      ]
    });

    // searchKey only
    expect((await listAppIds(owner, { searchKey: 'alpha' })).sort()).toEqual(
      [alphaSharedModelAppId, alphaOtherModelAppId].sort()
    );

    // searchKey + modelId: both conditions must be applied
    expect(await listAppIds(owner, { searchKey: 'alpha', modelId: 'shared-model' })).toEqual([
      alphaSharedModelAppId
    ]);

    // modelId must not be ignored when searchKey exists, and vice versa
    expect(await listAppIds(owner, { searchKey: 'beta', modelId: 'shared-model' })).toEqual([
      betaSharedModelAppId
    ]);
  });

  it('should respect app permissions for non-owner member when filter by modelId', async () => {
    const { owner, members } = await getFakeUsers(1);
    const member = members[0];

    // Folder shared to member, the app inside inherits folder permission
    const sharedFolderId = await createApp({
      auth: owner,
      name: 'shared-folder',
      type: AppTypeEnum.folder
    });
    const inheritedAppId = await createApp({
      auth: owner,
      name: 'shared-folder-app',
      parentId: sharedFolderId,
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'permission-model' }]
        })
      ]
    });
    // Root app without any permission record
    const privateAppId = await createApp({
      auth: owner,
      name: 'private-app',
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'permission-model' }]
        })
      ]
    });
    // Root app directly shared to member, must not appear when entering another folder
    const directSharedRootAppId = await createApp({
      auth: owner,
      name: 'direct-shared-root-app'
    });

    await MongoResourcePermission.create([
      {
        resourceType: PerResourceTypeEnum.app,
        teamId: owner.teamId,
        resourceId: sharedFolderId,
        tmbId: member.tmbId,
        permission: ReadPermissionVal
      },
      {
        resourceType: PerResourceTypeEnum.app,
        teamId: owner.teamId,
        resourceId: directSharedRootAppId,
        tmbId: member.tmbId,
        permission: ReadPermissionVal
      }
    ]);

    // Default list: no permission app is filtered out
    const memberRootList = await listAppIds(member, {});
    expect(memberRootList).toContain(directSharedRootAppId);
    expect(memberRootList).not.toContain(privateAppId);
    expect(memberRootList).not.toContain(inheritedAppId);

    // modelId is team wide, but still filtered by read permission:
    // inherited app is visible, private app is not
    const memberModelList = await listAppIds(member, { modelId: 'permission-model' });
    expect(memberModelList).toEqual([inheritedAppId]);
    expect(memberModelList).not.toContain(privateAppId);

    // Still works when navigating into the shared folder, without leaking other permitted apps
    const memberFolderList = await listAppIds(member, { parentId: sharedFolderId });
    expect(memberFolderList).toContain(inheritedAppId);
    expect(memberFolderList).not.toContain(directSharedRootAppId);
    expect(memberFolderList).not.toContain(privateAppId);
  });

  it('should not lose matched apps when searchKey result exceeds 50 rows', async () => {
    const { owner } = await getFakeUsers(1);

    const fillerCount = 55;
    const fillerApps = Array.from({ length: fillerCount }, (_, i) => ({
      teamId: owner.teamId,
      tmbId: owner.tmbId,
      name: `bulk-app-${i}`,
      type: AppTypeEnum.simple,
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'bulk-model' }]
        })
      ],
      // Newer than target app
      updateTime: new Date(Date.now() - i * 1000)
    }));
    const targetApp = {
      teamId: owner.teamId,
      tmbId: owner.tmbId,
      name: 'bulk-target-app',
      type: AppTypeEnum.simple,
      modules: [
        createNode({
          flowNodeType: FlowNodeTypeEnum.chatNode,
          inputs: [{ key: NodeInputKeyEnum.aiModel, value: 'bulk-model' }]
        })
      ],
      // Oldest app, would be cut off by a DB level limit
      updateTime: new Date(0)
    };

    const inserted = await MongoApp.insertMany([targetApp, ...fillerApps] as any[]);
    const targetAppId = String(inserted[0]._id);

    const list = await listAppIds(owner, { searchKey: 'bulk', modelId: 'bulk-model' });
    expect(list).toContain(targetAppId);
    // All matched apps should be returned, not truncated before model filtering
    expect(list.length).toBe(fillerCount + 1);

    // Plain keyword search still keeps the 50 rows limit
    const searchOnlyList = await listAppIds(owner, { searchKey: 'bulk' });
    expect(searchOnlyList.length).toBe(50);
  });
});
