import { MongoTeamMember } from '../../user/team/teamMemberSchema';
import { type UserModelSchema } from '@fastgpt/global/support/user/type';
import { type TeamSchema } from '@fastgpt/global/support/user/team/type';
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';
import {
  CacheKeyEnum,
  CacheKeyEnumTime,
  getRedisCache,
  setRedisCache
} from '../../../common/redis/cache';

const getChcheKey = (tmbId: string) => `${CacheKeyEnum.user_info}:${tmbId}`;
// TODO: 数据库优化
export async function getRunningUserInfoByTmbId(tmbId: string) {
  if (tmbId) {
    const cacheKey = getChcheKey(tmbId);
    // 尝试从缓存获取
    const cachedData = await getRedisCache(cacheKey);
    if (cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (e) {
        // 解析失败，继续往下走正常获取数据
      }
    }

    const tmb = await MongoTeamMember.findById(tmbId, 'teamId name userId') // team_members name is the user's name
      .populate<{ team: TeamSchema; user: UserModelSchema }>([
        {
          path: 'team',
          select: 'name'
        },
        {
          path: 'user',
          select: 'username contact'
        }
      ])
      .lean();

    if (!tmb) return Promise.reject(TeamErrEnum.notUser);

    const userInfo = {
      username: tmb.user.username,
      teamName: tmb.team.name,
      memberName: tmb.name,
      contact: tmb.user.contact || '',
      teamId: tmb.teamId,
      tmbId: tmb._id
    };
    // 存入缓存，设置过期时间为 3 小时
    await setRedisCache(cacheKey, JSON.stringify(userInfo), CacheKeyEnumTime.user_info);

    return userInfo;
  }

  return Promise.reject(TeamErrEnum.notUser);
}

export async function getUserChatInfo(tmbId: string) {
  const tmb = await MongoTeamMember.findById(tmbId, 'userId teamId')
    .populate<{ user: UserModelSchema; team: TeamSchema }>([
      {
        path: 'user',
        select: 'timezone'
      },
      {
        path: 'team',
        select: 'openaiAccount externalWorkflowVariables'
      }
    ])
    .lean();

  if (!tmb) return Promise.reject(TeamErrEnum.notUser);

  return {
    timezone: tmb.user.timezone,
    externalProvider: {
      openaiAccount: tmb.team.openaiAccount,
      externalWorkflowVariables: tmb.team.externalWorkflowVariables
    }
  };
}
