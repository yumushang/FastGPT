import { describe, expect, it } from 'vitest';
import {
  applySetPlan,
  applyPlanUpdate
} from '../../../../../../../core/workflow/dispatch/ai/tool/plan/state';

describe('applySetPlan', () => {
  it('creates plan with mapped fields and unique step ids', () => {
    const result = applySetPlan({ input: { name: 'report', steps: ['a', 'b'] } });

    expect(result.success).toBe(true);
    expect(result.plan.task).toBe('report');
    expect(result.plan.description).toBe('');
    expect(result.plan.source).toBe('toolCall');
    expect(result.plan.steps.map((s) => s.title)).toEqual(['a', 'b']);
    expect(result.plan.steps.every((s) => s.status === 'pending')).toBe(true);

    const ids = result.plan.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(result.plan.planId).toBeTruthy();

    expect(result.message).toContain('Set active plan "report" with 2 steps.');
    expect(result.message).toContain(
      'Plan progress: 0 done, 0 in progress, 2 pending, 0 blocked, 0 skipped.'
    );
    expect(result.message).toContain(`- ${ids[0]}: a | status=pending`);
  });

  it('generates distinct planId per call', () => {
    const a = applySetPlan({ input: { name: 'x', steps: ['s'] } });
    const b = applySetPlan({ input: { name: 'y', steps: ['s'] } });
    expect(a.plan.planId).not.toBe(b.plan.planId);
    expect(a.plan.steps[0].id).not.toBe(b.plan.steps[0].id);
  });

  it('returns blocked fallback on invalid args', () => {
    const result = applySetPlan({ input: { name: 'x', steps: [] } });
    expect(result.success).toBe(false);
    expect(result.plan.steps[0].status).toBe('blocked');
    expect(result.message).toContain('Invalid set_plan arguments');
  });
});

describe('applyPlanUpdate', () => {
  const base = () => applySetPlan({ input: { name: 'p', steps: ['a', 'b'] } }).plan;

  it('requires an active plan', () => {
    const r = applyPlanUpdate({
      plan: undefined,
      update: { updates: [{ id: 'x', status: 'done' }] }
    });
    expect(r.success).toBe(false);
    expect(r.message).toContain('Use set_plan first');
  });

  it('updates status and note', () => {
    const plan = base();
    const r = applyPlanUpdate({
      plan,
      update: { updates: [{ id: plan.steps[0].id, status: 'in_progress', note: 'working' }] }
    });
    expect(r.success).toBe(true);
    expect(r.plan.steps[0].status).toBe('in_progress');
    expect(r.plan.steps[0].note).toBe('working');
    expect(r.message).toContain('status=in_progress | note=working');
    expect(r.message).toContain('Updated 1 plan step.');
  });

  it('fails atomically on unknown step id', () => {
    const plan = base();
    const r = applyPlanUpdate({
      plan,
      update: {
        updates: [
          { id: plan.steps[0].id, status: 'done' },
          { id: 'nope', status: 'done' }
        ],
        add_steps: ['c']
      }
    });
    expect(r.success).toBe(false);
    expect(r.message).toContain('Unknown plan step: nope');
    expect(r.plan.steps[0].status).toBe('pending');
    expect(r.plan.steps.length).toBe(2);
  });

  it('appends new steps', () => {
    const plan = base();
    const r = applyPlanUpdate({ plan, update: { add_steps: ['c'] } });
    expect(r.success).toBe(true);
    expect(r.plan.steps.length).toBe(3);
    expect(r.plan.steps[2].status).toBe('pending');
    expect(r.message).toContain('Added plan step: "c".');
  });

  it('rejects empty update payload', () => {
    const r = applyPlanUpdate({ plan: base(), update: {} });
    expect(r.success).toBe(false);
  });
});
