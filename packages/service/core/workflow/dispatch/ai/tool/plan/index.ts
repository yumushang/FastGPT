import { createSetPlanTool, createUpdatePlanTool } from './updateTool';

export { setPlanToolName, updatePlanToolName } from '@fastgpt/global/core/ai/agent/constants';
export { createSetPlanTool, createUpdatePlanTool } from './updateTool';
export { applySetPlan, applyPlanUpdate, type UpdatePlanStateResult } from './state';

export const createPlanAgentTools = () => [createSetPlanTool(), createUpdatePlanTool()];
