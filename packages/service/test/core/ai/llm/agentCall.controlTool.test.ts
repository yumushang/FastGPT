import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmBodies: any[] = [];
let turn = 0;

vi.mock('@fastgpt/service/core/ai/llm/request', () => ({
  createLLMResponse: vi.fn(async ({ body }: any) => {
    llmBodies.push(body);
    turn++;
    if (turn <= 6) {
      const name = turn % 2 === 1 ? 'set_plan' : 'update_plan';
      const call = { id: `c${turn}`, type: 'function', function: { name, arguments: '{}' } };
      return {
        requestId: `r${turn}`,
        answerText: '',
        toolCalls: [call],
        usage: { inputTokens: 1, outputTokens: 1 },
        assistantMessage: { role: 'assistant', content: '', tool_calls: [call] },
        finish_reason: 'tool_calls'
      };
    }
    return {
      requestId: 'r7',
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

describe('runAgentCall controlToolNames', () => {
  beforeEach(() => {
    llmBodies.length = 0;
    turn = 0;
  });

  it('pure control turns do not trigger forced answer', async () => {
    await runAgentCall({
      ...baseProps(),
      controlToolNames: ['set_plan', 'update_plan']
    } as any);

    expect(llmBodies.length).toBe(7);
    expect(llmBodies[6].tool_choice).toBe('auto');
  });

  it('without controlToolNames the legacy force-answer still applies', async () => {
    await runAgentCall(baseProps() as any);

    expect(llmBodies.length).toBe(7);
    expect(llmBodies[6].tool_choice).toBe('none');
  });
});
