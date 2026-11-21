import type { AgentPlanType } from './type';

export const hasUnfinishedAgentPlan = (plan: AgentPlanType) =>
  plan.steps.some((step) => step.status !== 'done' && step.status !== 'skipped');
