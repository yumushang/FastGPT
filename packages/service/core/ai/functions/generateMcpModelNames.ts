import type { ChatCompletionMessageParam } from '@fastgpt/global/core/ai/llm/type';
import { MCP_TOOL_MODEL_NAME_REGEX } from '@fastgpt/global/core/app/tool/mcpTool/type';
import type { LLMModelDataType } from '@fastgpt/global/core/ai/model/schema';
import json5 from 'json5';
import { createLLMResponse } from '../llm/request';
import { getLogger, LogCategories } from '../../../common/logger';

const logger = getLogger(LogCategories.MODULE.AI.FUNCTIONS);

const MAX_MODEL_NAME_LENGTH = 35;

/** 将 LLM 输出清洗为合法模型名称：小写 snake_case、字母开头、限长、避开已占用名称。 */
const sanitizeModelName = (raw: string, used: Set<string>): string => {
  let name = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_MODEL_NAME_LENGTH);
  if (!name || /^\d/.test(name)) name = `t${name}`.slice(0, MAX_MODEL_NAME_LENGTH);
  if (!name) name = 'tool';

  let candidate = name;
  let suffix = 2;
  while (used.has(candidate) || !MCP_TOOL_MODEL_NAME_REGEX.test(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${name.slice(0, MAX_MODEL_NAME_LENGTH - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

const getSystemPrompt = () => `# Role
MCP 工具命名助手

## Task
根据工具的中文名称与描述，为每个工具生成一个语义化的英文 snake_case 标识符，作为模型 API 的工具名。

## Rules
- 只允许小写字母、数字、下划线，必须以小写字母开头，不超过 35 个字符
- 名称要体现工具用途，例如 query_xf_by_region、query_monthly_trend
- 不得与 <ExistingNames> 中的任何名称重复
- 严格按输入工具顺序，每个工具输出一个名称
- 只输出 JSON 字符串数组，例如 ["query_xf_by_region"]，不要输出任何解释或代码块标记`;

const getUserPrompt = (
  tools: Array<{ name: string; description?: string }>,
  existingNames: string[]
) => `<ExistingNames>
${JSON.stringify(existingNames)}
</ExistingNames>

<Tools>
${JSON.stringify(tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })))}
</Tools>

请按顺序为以上 ${tools.length} 个工具生成模型名称，只输出 JSON 数组。`;

/**
 * 调用团队默认 LLM 为 MCP 工具批量生成 ASCII 模型名称。
 * 解析失败时回退为序号占位名，保证返回值始终与 tools 等长且合法唯一。
 */
export async function generateMcpModelNames({
  tools,
  existingNames = [],
  model,
  teamId
}: {
  tools: Array<{ name: string; description?: string }>;
  existingNames?: string[];
  model: LLMModelDataType;
  teamId: string;
}): Promise<{
  modelNames: string[];
  inputTokens: number;
  outputTokens: number;
}> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: getUserPrompt(tools, existingNames) }
  ];

  const {
    answerText: answer,
    usage: { inputTokens, outputTokens }
  } = await createLLMResponse({
    teamId,
    saveLLMResponseRecord: false,
    body: {
      model,
      messages,
      stream: true,
      ...(model.config.reasoning ? { reasoning_effort: 'none' as const } : {})
    }
  });

  const used = new Set(existingNames);
  let parsed: string[] = [];

  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const arr = json5.parse(answer.substring(start, end + 1));
      if (Array.isArray(arr)) {
        parsed = arr.map((item) => String(item));
      }
    } catch (error) {
      logger.warn('Failed to parse generated MCP model names', { error, raw: answer });
    }
  }

  const modelNames = tools.map((tool, index) => {
    const raw = parsed[index];
    if (raw && MCP_TOOL_MODEL_NAME_REGEX.test(raw) && !used.has(raw)) {
      used.add(raw);
      return raw;
    }
    return sanitizeModelName(raw ?? `mcp_tool_${index + 1}`, used);
  });

  return { modelNames, inputTokens, outputTokens };
}
