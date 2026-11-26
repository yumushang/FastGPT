import type {
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from '@fastgpt/global/core/ai/llm/type';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import json5 from 'json5';

/*
  DeepSeek 系模型（V3.2/V4/flash）原生工具调用标记 DSML 的兜底解析。
  推理侧未把 DSML 翻译成 OpenAI tool_calls 时，标记会漏进 content，这里将其还原为工具调用并从文本中剥离。
  方言差异：竖线全角/半角、单/双写、允许空白；包络标签 calls/function_calls/tool_calls；包络缺失的孤儿 invoke。
*/
const BAR = String.raw`\s*(?:｜|\|){1,2}\s*`;
const OPEN = String.raw`<${BAR}DSML${BAR}`;
const CLOSE = String.raw`<\s*/\s*(?:｜|\|){1,2}\s*DSML${BAR}`;
const ENVELOPE = '(?:calls|function_calls|tool_calls|toolcalls)';

const START_RE = new RegExp(String.raw`${OPEN}(${ENVELOPE}|invoke)\b`);
const INVOKE_RE = new RegExp(
  String.raw`\n?${OPEN}invoke\s+name="([^"]*)"\s*>([\s\S]*?)${CLOSE}invoke\s*>\n?`,
  'g'
);
const PARAM_RE = new RegExp(
  String.raw`${OPEN}parameter\s+([^>]*?)>([\s\S]*?)${CLOSE}parameter\s*>`,
  'g'
);
const ENVELOPE_OPEN_RE = new RegExp(String.raw`\n?${OPEN}${ENVELOPE}\s*>\n?`, 'g');
const ENVELOPE_CLOSE_RE = new RegExp(String.raw`\n?${CLOSE}${ENVELOPE}\s*>\n?`, 'g');
const CLOSE_ENVELOPE_RE = new RegExp(String.raw`${CLOSE}${ENVELOPE}\s*>`);
const CLOSE_INVOKE_RE = new RegExp(String.raw`${CLOSE}invoke\s*>`);
const UNCLOSED_INVOKE_RE = new RegExp(String.raw`\n?${OPEN}invoke\s+name="([^"]*)"\s*>([\s\S]*)$`);
// 零参自闭合：<｜DSML｜invoke name="x"/>
const SELF_CLOSED_INVOKE_RE = new RegExp(
  String.raw`\n?${OPEN}invoke\s+name="([^"]*)"\s*/>\n?`,
  'g'
);
// 守卫 invoke 模式下识别已到达的完整自闭合头
const SELF_INVOKE_HEAD_RE = new RegExp(String.raw`^${OPEN}invoke\s+name="[^"]*"\s*/>`);
// 流截断残留的半截起始标记（如 <｜DSML｜inv），不能当正文补发
const PARTIAL_TAIL_RE = new RegExp(
  String.raw`<(?:\s*(?:｜|\|){1,2}\s*(?:D(?:S(?:M(?:L(?:[\s\S]*)?)?)?)?)?|\s*DSML[\s\S]*)$`
);

const parseJson = (str: string) => {
  try {
    return json5.parse(str);
  } catch {
    return undefined;
  }
};

const buildToolCall = ({
  name,
  body,
  tools
}: {
  name: string;
  body: string;
  tools?: ChatCompletionTool[];
}): ChatCompletionMessageToolCall | undefined => {
  const params: Record<string, any> = {};
  let hasParamTag = false;
  for (const match of body.matchAll(PARAM_RE)) {
    hasParamTag = true;
    const attrs = match[1];
    const paramName = /name="([^"]*)"/.exec(attrs)?.[1];
    if (!paramName) continue;
    const raw = match[2];
    params[paramName] = /string="false"/.test(attrs) ? parseJson(raw) ?? raw.trim() : raw.trim();
  }

  // invoke 体无 parameter 标签且直连 JSON 对象：整体视为入参
  if (!hasParamTag) {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = parseJson(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(params, parsed);
      }
    }
  }

  const schemaProps = tools?.find((tool) => tool.function.name === name)?.function.parameters
    ?.properties as Record<string, unknown> | undefined;
  // 模型可能把 OpenAI 的 {name, arguments} 结构套进 DSML 参数，此时 arguments 参数才是真实入参
  const unwrap = (() => {
    if (params.arguments === undefined) return false;
    if (schemaProps) return !('arguments' in schemaProps);
    return params.name === name || Object.keys(params).length === 1;
  })();

  const toolName = unwrap && typeof params.name === 'string' && params.name ? params.name : name;
  if (!toolName) return undefined;

  const args = (() => {
    if (!unwrap) return params;
    const rawArgs = params.arguments;
    const parsed = typeof rawArgs === 'string' ? parseJson(rawArgs) : rawArgs;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  })();
  if (!args) return undefined;

  return {
    id: getNanoid(6),
    type: 'function',
    function: { name: toolName, arguments: JSON.stringify(args) }
  };
};

export const parseDSMLToolCalls = (
  text: string,
  tools?: ChatCompletionTool[]
): { answer: string; toolCalls: ChatCompletionMessageToolCall[] } => {
  const toolCalls: ChatCompletionMessageToolCall[] = [];
  const collect = (name: string, body: string) => {
    const call = buildToolCall({ name, body, tools });
    if (call) toolCalls.push(call);
    return '';
  };

  // 自闭合先于 INVOKE_RE，防懒惰 body 吞并自闭合标签
  let answer = text.replace(SELF_CLOSED_INVOKE_RE, (_, name) => collect(name, ''));
  answer = answer.replace(INVOKE_RE, (_, name, body) => collect(name, body));
  answer = answer.replace(UNCLOSED_INVOKE_RE, (_, name, body) => collect(name, body));
  const stripped = answer
    .replace(ENVELOPE_OPEN_RE, '')
    .replace(ENVELOPE_CLOSE_RE, '')
    .replace(PARAM_RE, '')
    .replace(PARTIAL_TAIL_RE, '');

  if (stripped === text) return { answer: text, toolCalls: [] };
  return { answer: stripped.trim(), toolCalls };
};

/*
  流式守卫：疑似 DSML 起始的片段暂扣不发往 UI，收到完整 invoke 块立即还原为工具调用；
  确认非 DSML 的暂扣文本原样补发。flush 处理流结束时残留的半截标记。
*/
export const createDSMLStreamGuard = ({
  tools,
  onText,
  onToolCall
}: {
  tools?: ChatCompletionTool[];
  onText: (text: string) => void;
  onToolCall: (call: ChatCompletionMessageToolCall) => void;
}) => {
  let pending = '';
  let mode: 'text' | 'envelope' | 'invoke' = 'text';

  const emit = (text: string) => {
    if (text) onText(text);
  };
  const recover = (block: string) => {
    parseDSMLToolCalls(block, tools).toolCalls.forEach(onToolCall);
  };

  const scanText = () => {
    let cut = pending.length;
    let searchFrom = 0;
    let entered = false;
    while (true) {
      const idx = pending.indexOf('<', searchFrom);
      if (idx === -1) break;
      const tail = pending.slice(idx);
      const match = START_RE.exec(tail);
      if (match && match.index === 0) {
        mode = match[1] === 'invoke' ? 'invoke' : 'envelope';
        cut = idx;
        entered = true;
        break;
      }
      // 标签已闭合或超长仍非 DSML，判定为普通文本
      if (tail.length > 32 || /[>\n]/.test(tail)) {
        searchFrom = idx + 1;
        continue;
      }
      cut = idx;
      break;
    }
    const prefix = pending.slice(0, cut);
    if (entered) {
      // 与全文解析一致：吃掉标记前紧邻的一个换行
      emit(prefix.replace(/\n$/, ''));
      pending = pending.slice(cut);
    } else {
      // 疑似标记暂扣时，连同前置换行一起暂扣，避免补发时多出空行
      const hold = /\n+$/.exec(prefix)?.[0] ?? '';
      emit(prefix.slice(0, prefix.length - hold.length));
      pending = hold + pending.slice(cut);
    }
  };

  const tryClose = () => {
    if (mode === 'invoke') {
      const self = SELF_INVOKE_HEAD_RE.exec(pending);
      if (self) {
        recover(self[0]);
        pending = pending.slice(self[0].length).replace(/^\n/, '');
        mode = 'text';
        scanText();
        return;
      }
    }
    const match = (mode === 'envelope' ? CLOSE_ENVELOPE_RE : CLOSE_INVOKE_RE).exec(pending);
    if (!match) return;
    const end = match.index + match[0].length;
    recover(pending.slice(0, end));
    pending = pending.slice(end).replace(/^\n/, '');
    mode = 'text';
    scanText();
  };

  return {
    push: (fragment: string) => {
      if (!fragment) return;
      pending += fragment;
      if (mode === 'text') scanText();
      else tryClose();
    },
    flush: () => {
      const { answer, toolCalls } = parseDSMLToolCalls(pending, tools);
      toolCalls.forEach(onToolCall);
      pending = '';
      mode = 'text';
      emit(answer);
    }
  };
};

export const fingerprintToolCall = (call: ChatCompletionMessageToolCall) =>
  call.function.name + '\0' + call.function.arguments;

// base 原样保留（内部不去重，合法并行同参不丢）；extra 仅补新指纹
export const mergeToolCalls = (
  base: ChatCompletionMessageToolCall[],
  extra: ChatCompletionMessageToolCall[]
): { merged: ChatCompletionMessageToolCall[]; added: ChatCompletionMessageToolCall[] } => {
  const seen = new Set(base.map(fingerprintToolCall));
  const merged = [...base];
  const added: ChatCompletionMessageToolCall[] = [];
  for (const call of extra) {
    const key = fingerprintToolCall(call);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(call);
    added.push(call);
  }
  return { merged, added };
};
