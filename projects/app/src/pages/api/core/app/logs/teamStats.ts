import type { NextApiResponse } from 'next';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { Types } from '@fastgpt/service/common/mongo';
import { NextAPI } from '@/service/middleware/entry';
import { readFromSecondary } from '@fastgpt/service/common/mongo/utils';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { TeamManagePermissionVal } from '@fastgpt/global/support/permission/user/constant';
import type { ApiRequestProps } from '@fastgpt/service/type/next';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { AppCollectionName } from '@fastgpt/service/core/app/schema';
import {
  GetTeamAppChatStatsBodySchema,
  type GetTeamAppChatStatsResponse,
  type TeamAppChatStatsItemType
} from '@fastgpt/global/openapi/core/app/log/api';

async function handler(
  req: ApiRequestProps,
  _res: NextApiResponse
): Promise<GetTeamAppChatStatsResponse> {
  const { dateStart, dateEnd, sources } = GetTeamAppChatStatsBodySchema.parse(req.body);

  const { teamId } = await authUserPer({
    req,
    authToken: true,
    per: TeamManagePermissionVal
  });

  const aggregateResult = await MongoChat.aggregate(
    [
      {
        $match: {
          teamId: new Types.ObjectId(teamId),
          updateTime: {
            $gte: new Date(dateStart),
            $lte: new Date(dateEnd)
          },
          ...(sources?.length && { source: { $in: sources } })
        }
      },
      {
        $group: {
          _id: '$appId',
          chatCount: { $sum: 1 },
          errorCount: { $sum: { $ifNull: ['$errorCount', 0] } },
          tmbIds: { $addToSet: '$tmbId' },
          outLinkUids: { $addToSet: '$outLinkUid' }
        }
      },
      {
        $lookup: {
          from: AppCollectionName,
          localField: '_id',
          foreignField: '_id',
          as: 'app'
        }
      },
      { $unwind: '$app' },
      {
        $match: {
          'app.type': { $ne: AppTypeEnum.folder },
          'app.deleteTime': null
        }
      },
      {
        $project: {
          appId: '$_id',
          name: '$app.name',
          avatar: '$app.avatar',
          type: '$app.type',
          chatCount: 1,
          errorCount: 1,
          userCount: {
            $size: {
              $filter: {
                input: { $setUnion: ['$tmbIds', '$outLinkUids'] },
                as: 'user',
                cond: { $ne: ['$$user', null] }
              }
            }
          }
        }
      },
      { $sort: { chatCount: -1 } }
    ],
    { ...readFromSecondary }
  );

  const list = aggregateResult.map(
    (item): TeamAppChatStatsItemType => ({
      appId: String(item.appId),
      name: item.name,
      avatar: item.avatar,
      type: item.type,
      chatCount: item.chatCount,
      errorCount: item.errorCount,
      userCount: item.userCount
    })
  );

  return {
    list,
    totalChatCount: list.reduce((sum, item) => sum + item.chatCount, 0)
  };
}

export default NextAPI(handler);
