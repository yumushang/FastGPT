import { setPlanToolName, updatePlanToolName } from '@fastgpt/global/core/ai/agent/constants';
import type { AgentPlanType } from '@fastgpt/global/core/ai/agent/type';
import type {
  AIChatItemValueItemType,
  ToolModuleResponseItemType
} from '@fastgpt/global/core/chat/type';

const isPlanTool = (tool: ToolModuleResponseItemType) =>
  tool.functionName === setPlanToolName || tool.functionName === updatePlanToolName;

const isEmptyValue = (value: AIChatItemValueItemType) =>
  !value.text &&
  !value.reasoning &&
  !value.tools?.length &&
  !value.skills?.length &&
  !value.interactive &&
  !value.stepTitle &&
  !value.plan &&
  !value.tool;

/**
 * 收敛一轮内的 plan 快照：聊天只保留单个计划卡片（最终状态），
 * 上下文仅保留最后一次 plan 工具调用（隐藏条目，含全量步骤 id/状态）。
 */
export const compactToolCallPlanResponses = ({
  assistantResponses,
  finalPlan
}: {
  assistantResponses: AIChatItemValueItemType[];
  finalPlan?: AgentPlanType;
}): AIChatItemValueItemType[] => {
  const stripped: AIChatItemValueItemType[] = [];
  let lastPlanEntry: ToolModuleResponseItemType | undefined;
  let firstPlanIndex = -1;

  assistantResponses.forEach((value) => {
    const entries = value.tool ? [value.tool] : value.tools;
    const planEntries = entries?.filter(isPlanTool);
    if (!planEntries?.length) {
      stripped.push(value);
      return;
    }

    if (firstPlanIndex === -1) firstPlanIndex = stripped.length;
    lastPlanEntry = planEntries[planEntries.length - 1];

    const rest = entries!.filter((tool) => !isPlanTool(tool));
    const next: AIChatItemValueItemType = {
      ...value,
      tools: rest.length ? rest : undefined,
      tool: undefined
    };
    if (!isEmptyValue(next)) stripped.push(next);
  });

  if (finalPlan && lastPlanEntry) {
    stripped.splice(firstPlanIndex, 0, {
      tools: [{ ...lastPlanEntry, hideInUI: true }],
      plan: finalPlan
    });
  }

  return stripped;
};
