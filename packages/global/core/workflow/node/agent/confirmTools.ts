import z from 'zod';
import type { ChatCompletionTool } from '../../../ai/llm/type';

export const CONFIRM_TOOL_NAME = 'user_confirm';

export const ConfirmOptionSchema = z.union([
  z.string(),
  z.object({ label: z.string().min(1), description: z.string().optional() })
]);

export const ConfirmQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(ConfirmOptionSchema).optional(),
  multiple: z.boolean().optional()
});

export const ConfirmToolSchema = z.object({
  questions: z.array(ConfirmQuestionSchema).min(1).max(5)
});

export type ConfirmQuestionType = z.infer<typeof ConfirmQuestionSchema>;
export type ConfirmOptionType = { label: string; description?: string };

export const normalizeConfirm = (
  questions: ConfirmQuestionType[]
): { question: string; options: ConfirmOptionType[]; multiple: boolean }[] =>
  questions
    .map((q) => {
      const options = (q.options ?? [])
        .map((o) =>
          typeof o === 'string'
            ? { label: o.trim() }
            : { label: o.label.trim(), description: o.description?.trim() || undefined }
        )
        .filter((o) => o.label);
      const seen = new Set<string>();
      return {
        question: q.question.trim(),
        options: options
          .filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)))
          .slice(0, 8),
        multiple: q.multiple === true
      };
    })
    .filter((q) => q.question);

export const confirmToolsMap = {
  [CONFIRM_TOOL_NAME]: {
    name: {
      'zh-CN': '人工确认',
      'zh-Hant': '人工確認',
      en: 'UserConfirm'
    },
    avatar: 'core/workflow/template/userSelect',
    toolDescription:
      'Ask the user to confirm or choose. Use when a decision, approval or preference is required from the user.'
  }
};

export const CONFIRM_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: CONFIRM_TOOL_NAME,
    description:
      'Ask the user one or more confirmation questions and WAIT for their answers. Call this when you need a user decision, approval, or choice before proceeding (e.g. confirm an action, pick among alternatives). Questions render as a docked card with flat numbered options (single choice), inline checkboxes (multiple choice), or a free-text input when no options are given; users may also type a custom answer or skip. Do NOT use it for pure information questions you can answer yourself. Do NOT call it in parallel with other tools. The tool result contains the user answers keyed by question index, or a skip notice.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1-5 questions to ask the user in one confirmation.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question text shown to the user.' },
              options: {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        description: { type: 'string' }
                      },
                      required: ['label']
                    }
                  ]
                },
                description:
                  '2-8 choices, as plain strings or {label, description} objects. Omit or leave empty for a free-text question.'
              },
              multiple: {
                type: 'boolean',
                description: 'true = allow selecting multiple options (checkboxes).'
              }
            },
            required: ['question']
          }
        }
      },
      required: ['questions']
    }
  }
};
