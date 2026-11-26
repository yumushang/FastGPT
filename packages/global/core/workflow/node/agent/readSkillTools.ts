import z from 'zod';
import type { ChatCompletionTool } from '../../../ai/llm/type';

export const READ_SKILL_NAME = 'read_skill';

export const ReadSkillToolSchema = z.object({
  skill: z.string().min(1),
  focus: z.string().optional()
});

export const readSkillToolsMap = {
  [READ_SKILL_NAME]: {
    name: {
      'zh-CN': '读取技能',
      'zh-Hant': '讀取技能',
      en: 'ReadSkill'
    },
    avatar: 'core/skill/default',
    toolDescription: 'Read the full instruction body of a skill by name.'
  }
};

export const buildReadSkillTool = (
  skills: { nodeId: string; name: string; intro?: string }[]
): ChatCompletionTool => {
  const names = [...new Set(skills.map((s) => s.name.trim()).filter(Boolean))];
  const lines = skills.map(
    (s) => `- ${s.name}: ${(s.intro || '').replace(/\s+/g, ' ').slice(0, 80) || '（无简介）'}`
  );
  return {
    type: 'function',
    function: {
      name: READ_SKILL_NAME,
      description: `按需读取技能指令正文（先看目录，再深读单个技能）。可用技能目录：\n${lines.join(
        '\n'
      )}\n返回该技能完整指令，请严格遵照执行。`,
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            enum: names,
            description: '技能名称（见目录）'
          },
          focus: {
            type: 'string',
            description: '可选：本次关注的章节/问题，附加在正文之后'
          }
        },
        required: ['skill']
      }
    }
  };
};
