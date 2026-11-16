import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_GENERATING_TAKEOVER_MS,
  ensureGenerateChat,
  takeoverStaleEmptyGeneratingChat,
  tryStartGenerateChat,
  updateChatGenerateStatus
} from '@fastgpt/service/core/chat/chatGenerateStatus';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { ChatGenerateStatusEnum } from '@fastgpt/global/core/chat/constants';

vi.mock('@fastgpt/service/core/chat/chatSchema', () => ({
  MongoChat: {
    findOne: vi.fn(),
    updateOne: vi.fn()
  }
}));

vi.mock('@fastgpt/service/core/chat/chatItemSchema', () => ({
  MongoChatItem: {
    exists: vi.fn()
  }
}));

const baseParams = {
  appId: 'app1',
  chatId: 'chat1',
  teamId: 'team1',
  tmbId: 'tmb1',
  source: 'online',
  sourceName: 'FastGPT'
};

describe('chatGenerateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should ensure a chat is marked as generating', async () => {
    vi.mocked(MongoChat.updateOne).mockResolvedValue({} as any);

    await ensureGenerateChat(baseParams);

    expect(MongoChat.updateOne).toHaveBeenCalledWith(
      {
        appId: baseParams.appId,
        chatId: baseParams.chatId
      },
      {
        $set: expect.objectContaining({
          ...baseParams,
          hasBeenRead: false,
          chatGenerateStatus: ChatGenerateStatusEnum.generating,
          updateTime: expect.any(Date)
        }),
        $setOnInsert: {
          createTime: expect.any(Date)
        }
      },
      {
        upsert: true
      }
    );
  });

  it('should acquire generate slot when the chat is not already generating', async () => {
    vi.mocked(MongoChat.updateOne).mockResolvedValue({} as any);

    await expect(tryStartGenerateChat(baseParams)).resolves.toBe(true);

    expect(MongoChat.updateOne).toHaveBeenCalledWith(
      {
        appId: baseParams.appId,
        chatId: baseParams.chatId,
        chatGenerateStatus: {
          $ne: ChatGenerateStatusEnum.generating
        }
      },
      {
        $set: expect.objectContaining({
          ...baseParams,
          hasBeenRead: false,
          chatGenerateStatus: ChatGenerateStatusEnum.generating,
          updateTime: expect.any(Date)
        }),
        $setOnInsert: {
          createTime: expect.any(Date)
        }
      },
      {
        upsert: true
      }
    );
  });

  it('should reject acquiring generate slot when another request already owns it', async () => {
    vi.mocked(MongoChat.updateOne).mockRejectedValue({
      code: 11000
    });

    await expect(tryStartGenerateChat(baseParams)).resolves.toBe(false);
  });

  it('should update chat status to done or error without changing caller metadata', async () => {
    vi.mocked(MongoChat.updateOne).mockResolvedValue({ matchedCount: 1 } as any);

    await updateChatGenerateStatus({
      appId: baseParams.appId,
      chatId: baseParams.chatId,
      status: ChatGenerateStatusEnum.done
    });

    expect(MongoChat.updateOne).toHaveBeenCalledWith(
      {
        appId: baseParams.appId,
        chatId: baseParams.chatId
      },
      {
        $set: {
          chatGenerateStatus: ChatGenerateStatusEnum.done,
          updateTime: expect.any(Date),
          hasBeenRead: false
        }
      }
    );
  });

  describe('takeoverStaleEmptyGeneratingChat', () => {
    const mockChat = (chat: any) => {
      vi.mocked(MongoChat.findOne).mockReturnValue({
        lean: () => Promise.resolve(chat)
      } as any);
    };
    const staleUpdateTime = new Date(Date.now() - EMPTY_GENERATING_TAKEOVER_MS - 1000);

    it('should take over when the chat is stale, generating and empty', async () => {
      mockChat({
        chatGenerateStatus: ChatGenerateStatusEnum.generating,
        updateTime: staleUpdateTime
      });
      vi.mocked(MongoChatItem.exists).mockResolvedValue(null as any);
      vi.mocked(MongoChat.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: true
      });

      expect(MongoChat.updateOne).toHaveBeenCalledWith(
        {
          appId: baseParams.appId,
          chatId: baseParams.chatId,
          chatGenerateStatus: ChatGenerateStatusEnum.generating,
          updateTime: { $lt: expect.any(Date) }
        },
        {
          $set: expect.objectContaining({
            ...baseParams,
            hasBeenRead: false,
            chatGenerateStatus: ChatGenerateStatusEnum.generating,
            updateTime: expect.any(Date)
          })
        }
      );
    });

    it('should not take over when the chat already has messages', async () => {
      mockChat({
        chatGenerateStatus: ChatGenerateStatusEnum.generating,
        updateTime: staleUpdateTime
      });
      vi.mocked(MongoChatItem.exists).mockResolvedValue({ _id: 'item1' } as any);

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: false,
        reason: 'has_chat_item'
      });
      expect(MongoChat.updateOne).not.toHaveBeenCalled();
    });

    it('should not take over a recently updated generating chat', async () => {
      mockChat({
        chatGenerateStatus: ChatGenerateStatusEnum.generating,
        updateTime: new Date()
      });

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: false,
        reason: 'not_stale'
      });
      expect(MongoChatItem.exists).not.toHaveBeenCalled();
      expect(MongoChat.updateOne).not.toHaveBeenCalled();
    });

    it('should not take over when the chat is not generating', async () => {
      mockChat({
        chatGenerateStatus: ChatGenerateStatusEnum.done,
        updateTime: staleUpdateTime
      });

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: false,
        reason: 'not_generating'
      });
      expect(MongoChat.updateOne).not.toHaveBeenCalled();
    });

    it('should not take over when the chat does not exist', async () => {
      mockChat(null);

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: false,
        reason: 'chat_not_found'
      });
      expect(MongoChat.updateOne).not.toHaveBeenCalled();
    });

    it('should not take over when another request wins the takeover race', async () => {
      mockChat({
        chatGenerateStatus: ChatGenerateStatusEnum.generating,
        updateTime: staleUpdateTime
      });
      vi.mocked(MongoChatItem.exists).mockResolvedValue(null as any);
      vi.mocked(MongoChat.updateOne).mockResolvedValue({ modifiedCount: 0 } as any);

      await expect(takeoverStaleEmptyGeneratingChat(baseParams)).resolves.toMatchObject({
        ok: false,
        reason: 'race_lost'
      });
    });
  });
});
