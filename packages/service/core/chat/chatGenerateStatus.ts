/**
 * Service helpers for persisting per-chat generate status.
 * Used by stream resume, sidebar polling, and stale-generating correction paths.
 */
import { MongoChat } from './chatSchema';
import { MongoChatItem } from './chatItemSchema';
import { ChatGenerateStatusEnum } from '@fastgpt/global/core/chat/constants';
import { getLogger, LogCategories } from '../../common/logger';

const logger = getLogger(LogCategories.MODULE.CHAT.HISTORY);

type EnsureGenerateChatParams = {
  appId: string;
  chatId: string;
  teamId: string;
  tmbId: string;
  source: string;
  sourceName?: string;
  shareId?: string;
  outLinkUid?: string;
};

const buildGeneratingChatUpdate = (params: EnsureGenerateChatParams) => {
  const now = new Date();

  return {
    now,
    $set: {
      ...params,
      updateTime: now,
      hasBeenRead: false,
      chatGenerateStatus: ChatGenerateStatusEnum.generating
    },
    $setOnInsert: {
      createTime: now
    }
  };
};

export const ensureGenerateChat = async (params: EnsureGenerateChatParams) => {
  const { $set, $setOnInsert } = buildGeneratingChatUpdate(params);

  await MongoChat.updateOne(
    {
      appId: params.appId,
      chatId: params.chatId
    },
    {
      $set,
      $setOnInsert
    },
    {
      upsert: true
    }
  );
};

/** 空会话卡在 generating 超过该时长后，允许新请求接管 */
export const EMPTY_GENERATING_TAKEOVER_MS = 30 * 1000;

export const tryStartGenerateChat = async (params: EnsureGenerateChatParams) => {
  const { $set, $setOnInsert } = buildGeneratingChatUpdate(params);

  try {
    await MongoChat.updateOne(
      {
        appId: params.appId,
        chatId: params.chatId,
        chatGenerateStatus: {
          $ne: ChatGenerateStatusEnum.generating
        }
      },
      {
        $set,
        $setOnInsert
      },
      {
        upsert: true
      }
    );

    return true;
  } catch (error: any) {
    if (error?.code === 11000) {
      return false;
    }
    logger.error('Failed to acquire generate slot', {
      appId: params.appId,
      chatId: params.chatId,
      error
    });
    throw error;
  }
};

export type TakeoverEmptyGeneratingChatResult = {
  ok: boolean;
  reason?: 'chat_not_found' | 'not_generating' | 'not_stale' | 'has_chat_item' | 'race_lost';
  chatGenerateStatus?: ChatGenerateStatusEnum;
};

/**
 * 上一次请求异常退出（卡在 generating 但从未写入任何消息）时，允许新请求接管该空会话。
 * 仍使用带条件的 updateOne，保证并发下只有一个请求能接管成功。
 */
export const takeoverStaleEmptyGeneratingChat = async (
  params: EnsureGenerateChatParams
): Promise<TakeoverEmptyGeneratingChatResult> => {
  const { appId, chatId } = params;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - EMPTY_GENERATING_TAKEOVER_MS);

  const chat = await MongoChat.findOne({ appId, chatId }, 'chatGenerateStatus updateTime').lean();
  if (!chat) return { ok: false, reason: 'chat_not_found' };
  if (chat.chatGenerateStatus !== ChatGenerateStatusEnum.generating) {
    return { ok: false, reason: 'not_generating', chatGenerateStatus: chat.chatGenerateStatus };
  }
  if (!chat.updateTime || chat.updateTime.getTime() >= staleBefore.getTime()) {
    return {
      ok: false,
      reason: 'not_stale',
      chatGenerateStatus: chat.chatGenerateStatus
    };
  }

  const hasChatItem = await MongoChatItem.exists({ appId, chatId });
  if (hasChatItem) return { ok: false, reason: 'has_chat_item' };

  const { $set } = buildGeneratingChatUpdate(params);
  const { modifiedCount } = await MongoChat.updateOne(
    {
      appId,
      chatId,
      chatGenerateStatus: ChatGenerateStatusEnum.generating,
      updateTime: { $lt: staleBefore }
    },
    { $set }
  );

  return modifiedCount > 0 ? { ok: true } : { ok: false, reason: 'race_lost' };
};

type UpdateChatGenerateStatusParams = Pick<EnsureGenerateChatParams, 'appId' | 'chatId'> & {
  status: ChatGenerateStatusEnum;
  /** 若传入则覆盖；否则在 done/error 时默认未读（前台看完可再调 markRead） */
  hasBeenRead?: boolean;
};
export const updateChatGenerateStatus = async (params: UpdateChatGenerateStatusParams) => {
  const { appId, chatId, status, hasBeenRead } = params;
  const now = new Date();
  const $set: Record<string, unknown> = {
    chatGenerateStatus: status,
    updateTime: now
  };
  if (hasBeenRead !== undefined) {
    $set.hasBeenRead = hasBeenRead;
  } else if (status === ChatGenerateStatusEnum.done || status === ChatGenerateStatusEnum.error) {
    $set.hasBeenRead = false;
  }
  const result = await MongoChat.updateOne({ appId, chatId }, { $set });
  if (!result.matchedCount) {
    logger.warn('Chat generate status not updated: chat not found', { appId, chatId, status });
  }
};
