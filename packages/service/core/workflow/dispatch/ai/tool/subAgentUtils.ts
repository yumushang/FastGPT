import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import type { ChatCompletionMessageParam } from '@fastgpt/global/core/ai/llm/type';
import type { RuntimeNodeItemType } from '@fastgpt/global/core/workflow/runtime/type';
import { parseJsonArgs } from '../../../../ai/utils';
import type { ToolNodeItemType } from './type';

export const normalizeWhitelist = (raw: unknown): string[] => {
  const splitTokens = (values: string[]) =>
    values
      .flatMap((v) => String(v).split(/[,，、\n]/))
      .map((v) => v.trim())
      .filter(Boolean);

  if (raw == null || raw === '') return [];

  if (Array.isArray(raw)) {
    return [...new Set(splitTokens(raw.map((v) => String(v))))];
  }

  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return normalizeWhitelist(parsed);
      } catch {
        // fall through to comma split
      }
    }
    return [...new Set(splitTokens([s]))];
  }

  return [];
};

export const matchPoolByWhitelist = (
  pool: ToolNodeItemType[],
  raw: unknown
): { selected: ToolNodeItemType[]; misses: string[] } => {
  const tokens = normalizeWhitelist(raw);
  if (tokens.length === 0) return { selected: [], misses: [] };

  const selectedMap = new Map<string, ToolNodeItemType>();
  const misses: string[] = [];

  for (const token of tokens) {
    const byId = pool.find((t) => t.nodeId === token);
    if (byId) {
      selectedMap.set(byId.nodeId, byId);
      continue;
    }
    const byName = pool.filter((t) => t.name?.trim().toLowerCase() === token.toLowerCase());
    if (byName.length > 0) {
      byName.forEach((t) => selectedMap.set(t.nodeId, t));
    } else {
      misses.push(token);
    }
  }

  return { selected: [...selectedMap.values()], misses };
};

export const mergeToolNodes = (
  ownEdgeTools: ToolNodeItemType[],
  added: ToolNodeItemType[]
): ToolNodeItemType[] => {
  const map = new Map<string, ToolNodeItemType>();
  ownEdgeTools.forEach((t) => map.set(t.nodeId, t));
  added.forEach((t) => {
    if (!map.has(t.nodeId)) map.set(t.nodeId, t);
  });
  return [...map.values()];
};

export const buildToolPoolCatalog = (hiddenPool: ToolNodeItemType[]): string => {
  if (hiddenPool.length === 0) return '';

  const lines = hiddenPool.map((t) => {
    const intro = (t.toolDescription || t.intro || '').replace(/\s+/g, ' ').slice(0, 80);
    return `- 名称: ${t.name} | id: ${t.nodeId} | 简介: ${intro}`;
  });

  return `## 工具池目录（委派追加用）
子代理已自带其域内工具。需要跨域工具时，调用子代理工具并通过 toolWhitelist 参数按名称追加；留空则子代理仅用自带工具。

${lines.join('\n')}

### 委派指引
1. userChatInput：完整、自包含的任务描述（子代理看不到本对话历史，需写清背景、输入与期望输出）。
2. systemPrompt：可选，为本次调用特化子代理的角色与输出格式；不填则使用子代理的静态人设。
3. toolWhitelist：从上方目录挑选名称数组，宜小而精（2-5 个）；不需要跨域工具就留空。
4. directOutput：仅当工具输出即成品（如固定格式的工作流回复）时填 true，用户将直接收到原文且不再经过你总结；信息收集/多步任务一律 false（默认），由你整合后回答。
示例：用户问"出差打车费怎么报销" → 调用财务子代理，userChatInput="用户询问出差打车费报销流程，请给出步骤与政策依据"，toolWhitelist=["财务:报销政策"]，directOutput=false。
5. 子代理的答复会作为工具响应返回给你，由你整合后回复用户；不要替子代理重复执行其工具。
6. 目录中的 id 仅在工具重名时用于精确指定。`;
};

export const splitPoolForLLM = (
  toolNodes: ToolNodeItemType[],
  poolMode: boolean
): { llmToolNodes: ToolNodeItemType[]; catalog: string } => {
  const subAgents = toolNodes.filter((t) => t.flowNodeType === FlowNodeTypeEnum.subAgent);
  const active = poolMode && subAgents.length > 0;
  if (!active) return { llmToolNodes: toolNodes, catalog: '' };

  const hidden = toolNodes.filter((t) => t.flowNodeType !== FlowNodeTypeEnum.subAgent);
  return { llmToolNodes: subAgents, catalog: buildToolPoolCatalog(hidden) };
};

export const restoreToolStartParams = (
  memoryRequestMessages: ChatCompletionMessageParam[],
  toolCallId: string,
  entryNodeIds: string[]
): Record<string, any> | undefined => {
  for (const m of memoryRequestMessages) {
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    const call = m.tool_calls.find((tc) => tc.id === toolCallId);
    if (!call) continue;
    if (!entryNodeIds.includes(call.function.name)) return undefined;
    return parseJsonArgs(call.function.arguments);
  }
  return undefined;
};

export const readDirectOutput = (
  runtimeNode: RuntimeNodeItemType | undefined,
  startParams: Record<string, any> | undefined
): boolean => {
  const fromParams = startParams?.[NodeInputKeyEnum.directOutput];
  if (typeof fromParams === 'boolean') return fromParams;
  const fromNode = runtimeNode?.inputs.find((i) => i.key === NodeInputKeyEnum.directOutput)?.value;
  return fromNode === true;
};
