import { describe, expect, it } from 'vitest';
import { readToolCallActivePlan } from '../../../../../../../core/workflow/dispatch/ai/tool/plan/activePlan';
import {
  applySetPlan,
  applyPlanUpdate
} from '../../../../../../../core/workflow/dispatch/ai/tool/plan/state';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import type { ChatItemMiniType } from '@fastgpt/global/core/chat/type';

const ai = (value: any[]): ChatItemMiniType => ({ obj: ChatRoleEnum.AI, value }) as any;
const human = (text: string): ChatItemMiniType =>
  ({ obj: ChatRoleEnum.Human, value: [{ text: { content: text } }] }) as any;

describe('readToolCallActivePlan', () => {
  it('restores latest unfinished toolCall plan', () => {
    const plan = applySetPlan({ input: { name: 'p', steps: ['a'] } }).plan;
    const histories = [human('q'), ai([{ plan }]), human('continue')];
    expect(readToolCallActivePlan({ histories })?.planId).toBe(plan.planId);
  });

  it('returns undefined when plan completed', () => {
    const plan = applySetPlan({ input: { name: 'p', steps: ['a'] } }).plan;
    const done = applyPlanUpdate({
      plan,
      update: { updates: [{ id: plan.steps[0].id, status: 'done' }] }
    }).plan;
    expect(readToolCallActivePlan({ histories: [ai([{ plan: done }])] })).toBeUndefined();
  });

  it('does not revive older plan after a completed one', () => {
    const old = applySetPlan({ input: { name: 'old', steps: ['a'] } }).plan;
    const newer = applySetPlan({ input: { name: 'new', steps: ['b'] } }).plan;
    const done = applyPlanUpdate({
      plan: newer,
      update: { updates: [{ id: newer.steps[0].id, status: 'done' }] }
    }).plan;
    expect(
      readToolCallActivePlan({ histories: [ai([{ plan: old }]), ai([{ plan: done }])] })
    ).toBeUndefined();
  });

  it('skips Agent node plans without source', () => {
    const agentPlan = {
      planId: 'p1',
      task: 't',
      description: '',
      steps: [{ id: 's1', title: 'a', description: '' }]
    };
    expect(readToolCallActivePlan({ histories: [ai([{ plan: agentPlan }])] })).toBeUndefined();
  });

  it('null plan terminates restore', () => {
    const plan = applySetPlan({ input: { name: 'p', steps: ['a'] } }).plan;
    expect(
      readToolCallActivePlan({ histories: [ai([{ plan }]), ai([{ plan: null }])] })
    ).toBeUndefined();
  });

  it('returns undefined on empty histories', () => {
    expect(readToolCallActivePlan({ histories: [] })).toBeUndefined();
  });
});
