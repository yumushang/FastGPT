import { describe, expect, it } from 'vitest';
import { chats2GPTMessages } from '../../../core/chat/adapt';
import { mergePlanSSEValue } from '../../../core/chat/utils';
import { ChatRoleEnum } from '../../../core/chat/constants';
import type { AIChatItemValueItemType } from '../../../core/chat/type';
import type { AgentPlanType } from '../../../core/ai/agent/type';

const toolCallPlan: AgentPlanType = {
  planId: 'p1',
  task: 't',
  description: '',
  source: 'toolCall',
  steps: [{ id: 's1', title: 'a', description: '', status: 'pending' }]
};
const agentPlan: AgentPlanType = {
  planId: 'p2',
  task: 't',
  description: '',
  steps: [{ id: 's1', title: 'a', description: '' }]
};
const planToolEntry = {
  id: 'c1',
  toolName: '设置计划',
  toolAvatar: '',
  params: '{"name":"t","steps":["a"]}',
  response: 'Set active plan "t" with 1 step.',
  functionName: 'set_plan',
  hideInUI: true
};

describe('chats2GPTMessages plan source discrimination', () => {
  it('toolCall plan rebuilds real set_plan call instead of plan_agent', () => {
    const messages = chats2GPTMessages({
      messages: [
        {
          obj: ChatRoleEnum.AI,
          value: [{ tools: [planToolEntry], plan: toolCallPlan }]
        }
      ],
      reserveTool: true
    });

    const toolCallNames = messages
      .filter((m) => m.role === 'assistant' && 'tool_calls' in m && m.tool_calls)
      .flatMap((m) => (m as any).tool_calls.map((tc: any) => tc.function.name));

    expect(toolCallNames).toContain('set_plan');
    expect(toolCallNames).not.toContain('plan_agent');
    expect(messages.some((m) => m.role === 'tool' && m.content === planToolEntry.response)).toBe(
      true
    );
  });

  it('Agent plan without source still synthesizes plan_agent', () => {
    const messages = chats2GPTMessages({
      messages: [{ obj: ChatRoleEnum.AI, value: [{ plan: agentPlan }] }],
      reserveTool: true
    });

    const toolCallNames = messages
      .filter((m) => m.role === 'assistant' && 'tool_calls' in m && m.tool_calls)
      .flatMap((m) => (m as any).tool_calls.map((tc: any) => tc.function.name));

    expect(toolCallNames).toContain('plan_agent');
  });
});

describe('mergePlanSSEValue', () => {
  it('skeleton then card then in-place update by responseValueId', () => {
    let values: AIChatItemValueItemType[] = [];
    values = mergePlanSSEValue(values, {
      planStatus: { status: 'generating' },
      responseValueId: 'v1'
    });
    expect(values.length).toBe(1);
    expect(values[0].planStatus?.status).toBe('generating');

    values = mergePlanSSEValue(values, { plan: toolCallPlan, responseValueId: 'v1' });
    expect(values.length).toBe(1);
    expect(values[0].plan?.planId).toBe('p1');
    expect(values[0].planStatus).toBeUndefined();

    const updated = {
      ...toolCallPlan,
      steps: [{ ...toolCallPlan.steps[0], status: 'done' as const }]
    };
    values = mergePlanSSEValue(values, { plan: updated, responseValueId: 'v1' });
    expect(values.length).toBe(1);
    expect(values[0].plan?.steps[0].status).toBe('done');
  });

  it('appends when no responseValueId (Agent node compatibility)', () => {
    const values = mergePlanSSEValue([], { plan: agentPlan });
    expect(values.length).toBe(1);
    const values2 = mergePlanSSEValue(values, { plan: agentPlan });
    expect(values2.length).toBe(2);
  });

  it('appends for a different responseValueId', () => {
    const values = mergePlanSSEValue([{ id: 'v1', plan: toolCallPlan }], {
      plan: agentPlan,
      responseValueId: 'v2'
    });
    expect(values.length).toBe(2);
  });
});
