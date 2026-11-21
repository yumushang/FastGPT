import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import type { AIChatItemValueItemType, ChatItemMiniType } from '@fastgpt/global/core/chat/type';
import { AgentPlanSchema, type AgentPlanType } from '@fastgpt/global/core/ai/agent/type';
import { hasUnfinishedAgentPlan } from '@fastgpt/global/core/ai/agent/utils';

export const readToolCallActivePlan = ({
  histories
}: {
  histories: ChatItemMiniType[];
}): AgentPlanType | undefined => {
  for (let i = histories.length - 1; i >= 0; i--) {
    const item = histories[i];
    if (item.obj !== ChatRoleEnum.AI) continue;

    for (const value of item.value as AIChatItemValueItemType[]) {
      if (value.plan === null) return undefined;
      if (value.plan?.source !== 'toolCall') continue;

      const parsed = AgentPlanSchema.safeParse(value.plan);
      if (!parsed.success) return undefined;
      return hasUnfinishedAgentPlan(parsed.data) ? parsed.data : undefined;
    }
  }
  return undefined;
};
