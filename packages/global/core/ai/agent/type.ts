import { getNanoid } from '../../../common/string/tools';
import z from 'zod';

export const AgentPlanStepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'blocked',
  'skipped'
]);
export type AgentPlanStepStatusType = z.infer<typeof AgentPlanStepStatusSchema>;

export const AgentPlanStatusSchema = z.object({
  status: z.enum(['generating', 'updating'])
});
export type AgentPlanStatusType = z.infer<typeof AgentPlanStatusSchema>;

export const AgentStepItemSchema = z.object({
  id: z.string().default(getNanoid(6)),
  title: z.string(),
  description: z.string(),
  depends_on: z.array(z.string()).nullish(),
  response: z.string().nullish(),
  summary: z.string().nullish(),
  status: AgentPlanStepStatusSchema.nullish(),
  note: z.string().nullish()
});
export type AgentStepItemType = z.infer<typeof AgentStepItemSchema>;

export const AgentPlanSchema = z.object({
  planId: z.string().default(getNanoid(6)),
  task: z.string(),
  description: z.string(),
  background: z.string().nullish(),
  steps: z.array(AgentStepItemSchema),
  source: z.literal('toolCall').nullish()
});
export type AgentPlanType = z.infer<typeof AgentPlanSchema>;
