import { DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { NextAPI } from '@/service/middleware/entry';
import { DatasetPermission } from '@fastgpt/global/support/permission/dataset/controller';
import {
  PerResourceTypeEnum,
  ReadPermissionVal
} from '@fastgpt/global/support/permission/constant';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import { type ParentIdType } from '@fastgpt/global/common/parentFolder/type';
import { parseParentIdInMongo } from '@fastgpt/global/common/parentFolder/utils';
import { type ApiRequestProps } from '@fastgpt/service/type/next';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import { replaceRegChars } from '@fastgpt/global/common/string/tools';
import { getGroupsByTmbId } from '@fastgpt/service/support/permission/memberGroup/controllers';
import { getOrgIdSetWithParentByTmbId } from '@fastgpt/service/support/permission/org/controllers';
import { addSourceMember } from '@fastgpt/service/support/user/utils';
import { getEmbeddingModel } from '@fastgpt/service/core/ai/model';
import { sumPer } from '@fastgpt/global/support/permission/utils';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { Types } from '@fastgpt/service/common/mongo';

export type GetDatasetListBody = {
  parentId: ParentIdType;
  type?: DatasetTypeEnum;
  searchKey?: string;
};

async function handler(req: ApiRequestProps<GetDatasetListBody>) {
  const { parentId, type, searchKey } = req.body;

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
          authDataset({
            req,
            authToken: true,
            authApiKey: true,
            per: ReadPermissionVal,
            datasetId: parentId
          })
        ]
      : [])
  ]);

  // Get team all app permissions
  const [roleList, myGroupMap, myOrgSet] = await Promise.all([
    MongoResourcePermission.find({
      resourceType: PerResourceTypeEnum.dataset,
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
  const myRoles = roleList.filter(
    (item) =>
      String(item.tmbId) === String(tmbId) ||
      myGroupMap.has(String(item.groupId)) ||
      myOrgSet.has(String(item.orgId))
  );

  // 校验是否是合法的 MongoDB ObjectId (24 hex chars)
  const isObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

  // 如果是 ObjectId, 同时也作为数据集id查询出对应知识库id
  let datasetIdsFromCollection: string[] = [];
  if (searchKey && isObjectId(searchKey)) {
    const collections = await MongoDatasetCollection.find({
      _id: new Types.ObjectId(searchKey)
    }).select('datasetId');
    datasetIdsFromCollection = collections.map((c) => String(c.datasetId));
  }

  const findDatasetQuery = (() => {
    // Filter apps by permission, if not owner, only get apps that I have permission to access
    const idList = { _id: { $in: myRoles.map((item) => item.resourceId) } };
    const datasetPerQuery = teamPer.isOwner
      ? {}
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
            ...(isObjectId(searchKey) ? [{ _id: new Types.ObjectId(searchKey) }] : [])
          ]
        }
      : {};

    // 根据数据集id查询知识库 过滤条件
    const datasetIdFromCollectionMatch =
      datasetIdsFromCollection.length > 0
        ? {
            _id: {
              $in: datasetIdsFromCollection.map((id) => new Types.ObjectId(id))
            }
          }
        : null;

    if (searchKey) {
      const data: any = {
        ...datasetPerQuery,
        teamId,
        deleteTime: null, // 搜索时也要过滤已删除数据
        ...(datasetIdFromCollectionMatch
          ? {
              $or: [...(searchMatch.$or || []), datasetIdFromCollectionMatch]
            }
          : searchMatch)
      };
      delete data.parentId;
      return data;
    }

    return {
      ...datasetPerQuery,
      teamId,
      deleteTime: null, // 关键：只返回未删除的数据
      ...(type ? (Array.isArray(type) ? { type: { $in: type } } : { type }) : {}),
      ...parseParentIdInMongo(parentId)
    };
  })();

  const myDatasets = await MongoDataset.find(findDatasetQuery)
    .sort({
      updateTime: -1
    })
    .lean();

  const formatDatasets = myDatasets
    .map((dataset) => {
      const { Per, privateDataset } = (() => {
        const getPer = (datasetId: string) => {
          const tmbRole = myRoles.find(
            (item) => String(item.resourceId) === datasetId && !!item.tmbId
          )?.permission;
          const groupAndOrgRole = sumPer(
            ...myRoles
              .filter(
                (item) => String(item.resourceId) === datasetId && (!!item.groupId || !!item.orgId)
              )
              .map((item) => item.permission)
          );
          return new DatasetPermission({
            role: tmbRole ?? groupAndOrgRole,
            isOwner: String(dataset.tmbId) === String(tmbId) || teamPer.isOwner
          });
        };
        const getClbCount = (datasetId: string) => {
          return roleList.filter((item) => String(item.resourceId) === String(datasetId)).length;
        };

        // inherit
        if (
          dataset.inheritPermission &&
          dataset.parentId &&
          dataset.type !== DatasetTypeEnum.folder
        ) {
          return {
            Per: getPer(String(dataset.parentId)).addRole(getPer(String(dataset._id)).role),
            privateDataset: getClbCount(String(dataset.parentId)) <= 1
          };
        }
        return {
          Per: getPer(String(dataset._id)),
          privateDataset: getClbCount(String(dataset._id)) <= 1
        };
      })();

      return {
        _id: dataset._id,
        avatar: dataset.avatar,
        name: dataset.name,
        intro: dataset.intro,
        type: dataset.type,
        vectorModel: getEmbeddingModel(dataset.vectorModel),
        inheritPermission: dataset.inheritPermission,
        tmbId: dataset.tmbId,
        updateTime: dataset.updateTime,
        permission: Per,
        private: privateDataset
      };
    })
    .filter((app) => app.permission.hasReadPer);

  return addSourceMember({
    list: formatDatasets
  });
}

export default NextAPI(handler);
