import { MongoApp } from '@fastgpt/service/core/app/schema';
import { type AppListItemType } from '@fastgpt/global/core/app/type';
import { NextAPI } from '@/service/middleware/entry';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import {
  PerResourceTypeEnum,
  ReadPermissionVal
} from '@fastgpt/global/support/permission/constant';
import { AppPermission } from '@fastgpt/global/support/permission/app/controller';
import { type ApiRequestProps } from '@fastgpt/service/type/next';
import { type ParentIdType } from '@fastgpt/global/common/parentFolder/type';
import { parseParentIdInMongo } from '@fastgpt/global/common/parentFolder/utils';
import { AppFolderTypeList, AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { authApp } from '@fastgpt/service/support/permission/app/auth';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { replaceRegChars } from '@fastgpt/global/common/string/tools';
import { getGroupsByTmbId } from '@fastgpt/service/support/permission/memberGroup/controllers';
import { getOrgIdSetWithParentByTmbId } from '@fastgpt/service/support/permission/org/controllers';
import { addSourceMember } from '@fastgpt/service/support/user/utils';
import {
  FlowNodeInputTypeEnum,
  FlowNodeTypeEnum
} from '@fastgpt/global/core/workflow/node/constant';
import { sumPer } from '@fastgpt/global/support/permission/utils';
import { MongoOpenApi } from '@fastgpt/service/support/openapi/schema';
import { NodeInputKeyEnum, VariableInputEnum } from '@fastgpt/global/core/workflow/constants';

export type ListAppBody = {
  parentId?: ParentIdType;
  type?: AppTypeEnum | AppTypeEnum[];
  searchKey?: string;
  modelId?: string;
};

/*
  获取 APP 列表权限
  1. 校验 folder 权限和获取 team 权限（owner 单独处理）
  2. 获取 team 下所有 app 权限。获取我的所有组。并计算出我所有的app权限。
  3. 过滤我有的权限的 app，以及当前 parentId 的 app（由于权限继承问题，这里没法一次性根据 id 去获取）
  4. 根据过滤条件获取 app 列表
  5. 遍历搜索出来的 app，并赋予权限（继承的 app，使用 parent 的权限）
  6. 再根据 read 权限进行一次过滤。
*/

async function handler(req: ApiRequestProps<ListAppBody>): Promise<AppListItemType[]> {
  const { parentId, type, searchKey, modelId } = req.body;

  // Auth user permission
  const [{ tmbId, teamId, permission: teamPer }] = await Promise.all([
    authUserPer({
      req,
      authToken: true,
      authApiKey: true,
      per: ReadPermissionVal
    }),
    ...(parentId
      ? [
          authApp({
            req,
            authToken: true,
            authApiKey: true,
            appId: parentId,
            per: ReadPermissionVal
          })
        ]
      : [])
  ]);

  // Get team all app permissions
  const [roleList, myGroupMap, myOrgSet] = await Promise.all([
    MongoResourcePermission.find({
      resourceType: PerResourceTypeEnum.app,
      teamId,
      resourceId: {
        $exists: true
      }
    }).lean(),
    getGroupsByTmbId({
      tmbId,
      teamId
    }).then((item) => {
      const map = new Map<string, 1>();
      item.forEach((item) => {
        map.set(String(item._id), 1);
      });
      return map;
    }),
    getOrgIdSetWithParentByTmbId({
      teamId,
      tmbId
    })
  ]);
  // Get my permissions
  const myPerList = roleList.filter(
    (item) =>
      String(item.tmbId) === String(tmbId) ||
      myGroupMap.has(String(item.groupId)) ||
      myOrgSet.has(String(item.orgId))
  );

  // Search: if searchKey matches apiKey, get corresponding appIds
  const appIdsFromApiKey = searchKey
    ? ((await MongoOpenApi.find(
        {
          teamId,
          apiKey: { $regex: new RegExp(`${replaceRegChars(searchKey)}`, 'i') }
        },
        'appId'
      )
        .lean()
        .then((items) => items.map((item) => item.appId).filter(Boolean))) as string[])
    : [];

  const findAppsQuery = (() => {
    // 关键词搜索、按模型筛选均为全团队范围，不限制在 parentId 下（权限由下方 hasReadPer 过滤兜底）
    const isTeamWide = !!(searchKey || modelId);

    // Filter apps by permission, if not owner, only get apps that I have permission to access
    const idList = { _id: { $in: myPerList.map((item) => item.resourceId) } };
    const appPerQuery = isTeamWide
      ? {}
      : teamPer.isOwner
        ? parentId
          ? parseParentIdInMongo(parentId)
          : { parentId: null }
        : parentId
          ? {
              $or: [idList, parseParentIdInMongo(parentId)]
            }
          : { $or: [idList, { parentId: null }] };

    const searchMatch = searchKey
      ? {
          $or: [
            { name: { $regex: new RegExp(`${replaceRegChars(searchKey)}`, 'i') } },
            { intro: { $regex: new RegExp(`${replaceRegChars(searchKey)}`, 'i') } },
            ...(appIdsFromApiKey.length > 0 ? [{ _id: { $in: appIdsFromApiKey } }] : [])
          ]
        }
      : {};

    const _type = (() => {
      if (type) {
        // 如果明确指定了类型，则按指定类型查询（包括 hidden）
        return Array.isArray(type) ? { $in: type } : type;
      }
      // 如果没有指定类型，则排除 hidden 类型
      return { $ne: AppTypeEnum.hidden } as const;
    })();

    // 匹配某个节点输入（inputs）的条件
    const nodeInputMatch = (inputMatch: Record<string, unknown>) => ({
      modules: {
        $elemMatch: {
          inputs: {
            $elemMatch: inputMatch
          }
        }
      }
    });

    // Filter apps by used model (workflow nodes & chatConfig & app variables)
    const modelMatch = modelId
      ? {
          $or: [
            // 节点输入的扁平模型字段
            nodeInputMatch({
              key: {
                $in: [
                  NodeInputKeyEnum.aiModel,
                  NodeInputKeyEnum.datasetSearchRerankModel,
                  NodeInputKeyEnum.datasetSearchExtensionModel,
                  NodeInputKeyEnum.datasetDeepSearchModel
                ]
              },
              value: modelId
            }),
            // agent 节点：数据集检索配置存在 agent_datasetParams 内
            nodeInputMatch({
              key: NodeInputKeyEnum.datasetParams,
              $or: [
                { 'value.rerankModel': modelId },
                { 'value.datasetSearchExtensionModel': modelId },
                { 'value.datasetDeepSearchModel': modelId }
              ]
            }),
            // 旧版系统配置节点（userGuide）：tts / questionGuide 的模型
            {
              modules: {
                $elemMatch: {
                  flowNodeType: FlowNodeTypeEnum.systemConfig,
                  inputs: {
                    $elemMatch: {
                      key: { $in: [NodeInputKeyEnum.tts, NodeInputKeyEnum.questionGuide] },
                      'value.model': modelId
                    }
                  }
                }
              }
            },
            // 自定义模型输入（renderTypeList 含 selectLLMModel）：当前值或默认值
            nodeInputMatch({
              renderTypeList: FlowNodeInputTypeEnum.selectLLMModel,
              $or: [{ value: modelId }, { defaultValue: modelId }]
            }),
            // 表单输入节点：selectLLMModel 字段的默认值
            nodeInputMatch({
              key: NodeInputKeyEnum.userInputForms,
              value: {
                $elemMatch: {
                  type: FlowNodeInputTypeEnum.selectLLMModel,
                  defaultValue: modelId
                }
              }
            }),
            // 应用变量：llmSelect 变量的默认值
            {
              'chatConfig.variables': {
                $elemMatch: {
                  type: VariableInputEnum.llmSelect,
                  defaultValue: modelId
                }
              }
            },
            { 'chatConfig.ttsConfig.model': modelId },
            { 'chatConfig.questionGuide.model': modelId }
          ]
        }
      : {};

    // 权限、关键词、模型条件各自独立，用 $and 组合，避免 $or 被展开覆盖
    const andConditions = [
      appPerQuery,
      ...(searchKey ? [searchMatch] : []),
      ...(modelId ? [modelMatch] : [])
    ].filter((item) => Object.keys(item).length > 0);

    return {
      teamId,
      type: _type,
      ...(andConditions.length > 0 ? { $and: andConditions } : {})
    };
  })();
  const limit = (() => {
    // 仅按关键词搜索时限制条数；带 modelId 时权限为后置过滤，预截断会挤掉有权限的结果
    if (searchKey && !modelId) return 50;
    return;
  })();

  const myApps = await MongoApp.find(
    { ...findAppsQuery, deleteTime: null },
    '_id parentId avatar type name intro tmbId updateTime pluginData inheritPermission modules',
    {
      limit: limit
    }
  )
    .sort({
      updateTime: -1
    })
    .lean();

  // Add app permission and filter apps by read permission
  const formatApps = myApps
    .map((app) => {
      const { Per, privateApp } = (() => {
        const getPer = (appId: string) => {
          const tmbRole = myPerList.find(
            (item) => String(item.resourceId) === appId && !!item.tmbId
          )?.permission;
          const groupAndOrgRole = sumPer(
            ...myPerList
              .filter(
                (item) => String(item.resourceId) === appId && (!!item.groupId || !!item.orgId)
              )
              .map((item) => item.permission)
          );

          return new AppPermission({
            role: tmbRole ?? groupAndOrgRole,
            isOwner: String(app.tmbId) === String(tmbId) || teamPer.isOwner
          });
        };

        const getClbCount = (appId: string) => {
          return roleList.filter((item) => String(item.resourceId) === String(appId)).length;
        };

        // Inherit app, check parent folder clb and it's own clb
        if (!AppFolderTypeList.includes(app.type) && app.parentId && app.inheritPermission) {
          return {
            Per: getPer(String(app.parentId)).addRole(getPer(String(app._id)).role),
            privateApp: getClbCount(String(app.parentId)) <= 1
          };
        }

        return {
          Per: getPer(String(app._id)),
          privateApp: getClbCount(String(app._id)) <= 1
        };
      })();

      const { modules, ...rest } = app;
      const hasInteractiveNode = modules?.some((item) =>
        [FlowNodeTypeEnum.formInput, FlowNodeTypeEnum.userSelect].includes(item.flowNodeType)
      );

      return {
        ...rest,
        parentId: app.parentId,
        permission: Per,
        private: privateApp,
        hasInteractiveNode
      };
    })
    .filter((app) => app.permission.hasReadPer);

  return addSourceMember({
    list: formatApps
  });
}

export default NextAPI(handler);
