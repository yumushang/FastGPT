import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmBodies: any[] = [];
let turn = 0;
let scenario: 'contradiction' | 'answer' | 'normal' = 'contradiction';

vi.mock('@fastgpt/service/core/ai/llm/request', () => ({
  createLLMResponse: vi.fn(async ({ body }: any) => {
    llmBodies.push(body);
    turn++;
    if (scenario === 'contradiction') {
      return {
        requestId: `r${turn}`,
        answerText: '',
        toolCalls: [],
        reasoningText: 'thinking',
        usage: { inputTokens: 1, outputTokens: 1 },
        assistantMessage: { role: 'assistant', reasoning_content: 'thinking' },
        finish_reason: 'tool_calls'
      };
    }
    if (scenario === 'answer') {
      return {
        requestId: 'r1',
        answerText: 'hi',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        assistantMessage: { role: 'assistant', content: 'hi' },
        finish_reason: 'tool_calls'
      };
    }
    if (turn === 1) {
      const call = {
        id: 'c1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{}' }
      };
      return {
        requestId: 'r1',
        answerText: '',
        toolCalls: [call],
        usage: { inputTokens: 1, outputTokens: 1 },
        assistantMessage: { role: 'assistant', tool_calls: [call] },
        finish_reason: 'tool_calls'
      };
    }
    return {
      requestId: 'r2',
      answerText: 'done',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      assistantMessage: { role: 'assistant', content: 'done' },
      finish_reason: 'stop'
    };
  })
}));
vi.mock('@fastgpt/service/core/ai/llm/compress', () => ({
  compressRequestMessages: vi.fn(async ({ messages }: any) => ({ messages })),
  compressToolResponse: vi.fn(async ({ response }: any) => ({ compressed: response }))
}));
vi.mock('@fastgpt/service/core/ai/model', () => ({
  getLLMModel: vi.fn(() => ({
    model: 'test',
    name: 'test',
    maxContext: 100000,
    toolChoice: true
  }))
}));
vi.mock('@fastgpt/service/core/ai/llm/utils', () => ({
  filterGPTMessageByMaxContext: vi.fn(async ({ messages }: any) => messages)
}));
vi.mock('@fastgpt/service/common/string/tiktoken/index', () => ({
  countGptMessagesTokens: vi.fn(async () => 0)
}));
vi.mock('@fastgpt/service/support/wallet/usage/utils', () => ({
  formatModelChars2Points: vi.fn(() => ({ totalPoints: 0 }))
}));
vi.mock('@fastgpt/web/i18n/utils', () => ({
  i18nT: vi.fn((key: string) => key)
}));

import { runAgentCall } from '../../../../core/ai/llm/agentCall';

const baseProps = () => ({
  maxRunAgentTimes: 10,
  body: {
    model: 'test',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [],
    stream: false
  },
  usagePush: vi.fn(),
  isAborted: () => false,
  handleInteractiveTool: vi.fn(),
  handleToolResponse: vi.fn(async () => ({
    response: 'ok',
    assistantMessages: [],
    usages: []
  }))
});

describe('runAgentCall empty toolCalls contradiction', () => {
  beforeEach(() => {
    llmBodies.length = 0;
    turn = 0;
    scenario = 'contradiction';
  });

  it('rejects with visible tip when finish_reason is tool_calls but no tool call parsed', async () => {
    await expect(runAgentCall(baseProps() as any)).rejects.toBe(
      'chat:LLM_tool_call_response_empty'
    );
    expect(llmBodies.length).toBe(1);
  });

  it('does not reject when answer text exists', async () => {
    scenario = 'answer';
    const result = await runAgentCall(baseProps() as any);

    expect(llmBodies.length).toBe(1);
    expect(result.assistantMessages.some((m: any) => m.content === 'hi')).toBe(true);
  });

  it('keeps normal tool call turns unchanged', async () => {
    scenario = 'normal';
    const props = baseProps();
    const result = await runAgentCall(props as any);

    expect(llmBodies.length).toBe(2);
    expect(props.handleToolResponse).toHaveBeenCalledTimes(1);
    expect(result.assistantMessages.some((m: any) => m.content === 'done')).toBe(true);
  });
});
