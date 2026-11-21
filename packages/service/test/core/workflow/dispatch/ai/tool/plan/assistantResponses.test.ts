import { describe, expect, it } from 'vitest';
import { compactToolCallPlanResponses } from '../../../../../../../core/workflow/dispatch/ai/tool/plan/assistantResponses';
import {
  applySetPlan,
  applyPlanUpdate
} from '../../../../../../../core/workflow/dispatch/ai/tool/plan/state';
import type { AIChatItemValueItemType } from '@fastgpt/global/core/chat/type';

const planTool = (id: string, functionName: string, response: string) => ({
  id,
  toolName: 'plan',
  toolAvatar: '',
  params: '{}',
  response,
  functionName
});
const otherTool = (id: string) => ({
  id,
  toolName: 't',
  toolAvatar: '',
  params: '{}',
  response: 'ok',
  functionName: id
});

describe('compactToolCallPlanResponses', () => {
  it('inserts single plan value at first plan round with hidden last entry', () => {
    const set = applySetPlan({ input: { name: 'p', steps: ['a'] } });
    const upd = applyPlanUpdate({
      plan: set.plan,
      update: { updates: [{ id: set.plan.steps[0].id, status: 'done' }] }
    });
    const values = [
      { tools: [planTool('c1', 'set_plan', set.message)] },
      { tools: [otherTool('t1'), planTool('c2', 'update_plan', upd.message)] },
      { text: { content: 'final' } }
    ] as AIChatItemValueItemType[];

    const result = compactToolCallPlanResponses({
      assistantResponses: values,
      finalPlan: upd.plan
    });

    expect(result.length).toBe(3);
    expect(result[0].plan?.planId).toBe(upd.plan.planId);
    expect(result[0].tools?.length).toBe(1);
    expect(result[0].tools?.[0].id).toBe('c2');
    expect(result[0].tools?.[0].hideInUI).toBe(true);
    expect(result[0].tools?.[0].response).toBe(upd.message);
    expect(result[1].tools?.map((t) => t.id)).toEqual(['t1']);
    expect(result[2].text?.content).toBe('final');
  });

  it('drops empty values and keeps mixed text round', () => {
    const set = applySetPlan({ input: { name: 'p', steps: ['a'] } });
    const values = [
      { tools: [planTool('c1', 'set_plan', set.message)] },
      { text: { content: 'hi' }, tools: [planTool('c2', 'set_plan', set.message)] }
    ] as AIChatItemValueItemType[];

    const result = compactToolCallPlanResponses({
      assistantResponses: values,
      finalPlan: set.plan
    });

    expect(result.length).toBe(2);
    expect(result[0].plan).toBeTruthy();
    expect(result[1].text?.content).toBe('hi');
    expect(result[1].tools).toBeUndefined();
  });

  it('keeps values unchanged without plan calls', () => {
    const values = [{ text: { content: 'x' } }] as AIChatItemValueItemType[];
    expect(compactToolCallPlanResponses({ assistantResponses: values })).toEqual(values);
  });

  it('strips failed plan entries without inserting plan value', () => {
    const values = [
      { tools: [planTool('c1', 'set_plan', 'Invalid set_plan arguments: bad')] }
    ] as AIChatItemValueItemType[];
    const result = compactToolCallPlanResponses({ assistantResponses: values });
    expect(result.length).toBe(0);
  });
});
