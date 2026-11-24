import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmBodies: any[] = [];
let turn = 0;

vi.mock('@fastgpt/service/core/ai/llm/request', () => ({
  createLLMResponse: vi.fn(async ({ body }: any) => {
    llmBodies.push(body);
    turn++;
    if (turn === 1) {
      const call = {
        id: 'c1',
        type: 'function',
        function: {
          name: 'user_confirm',
          arguments: '{"questions":[{"question":"Q","options":["A","B"]}]}'
        }
      };
      return {
        requestId: 'r1',
        answerText: '',
        toolCalls: [call],
        usage: { inputTokens: 1, outputTokens: 1 },
        assistantMessage: { role: 'assistant', content: '', tool_calls: [call] },
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
  getLLMModel: vi.fn(() => ({ model: 'test', name: 'test', maxContext: 100000, toolChoice: true }))
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

import { runAgentCall } from '../../../../core/ai/llm/agentCall';

const interactive = {
  type: 'userInput',
  params: { description: 'Q', inputForm: [] },
  entryNodeIds: ['user_confirm'],
  memoryEdges: [],
  nodeOutputs: []
};

beforeEach(() => {
  llmBodies.length = 0;
  turn = 0;
});

describe('runAgentCall user_confirm suspend/resume', () => {
  it('suspend wraps toolChildrenInteractive with placeholder tool message', async () => {
    const res = await runAgentCall({
      maxRunAgentTimes: 10,
      body: {
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        stream: false
      },
      usagePush: vi.fn(),
      isAborted: () => false,
      handleInteractiveTool: vi.fn(),
      handleToolResponse: vi.fn(async () => ({
        response: '等待用户确认',
        assistantMessages: [],
        usages: [],
        interactive
      }))
    } as any);

    expect(res.interactiveResponse.type).toBe('toolChildrenInteractive');
    expect(res.interactiveResponse.params.toolParams.toolCallId).toBe('c1');
    const mem = res.interactiveResponse.params.toolParams.memoryRequestMessages;
    const toolMsg = mem.find((m: any) => m.role === 'tool' && m.tool_call_id === 'c1');
    expect(toolMsg.content).toBe('等待用户确认');
    expect(llmBodies.length).toBe(1);
  });

  it('resume replaces placeholder with user answers and continues loop', async () => {
    const suspend = await runAgentCall({
      maxRunAgentTimes: 10,
      body: {
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        stream: false
      },
      usagePush: vi.fn(),
      isAborted: () => false,
      handleInteractiveTool: vi.fn(),
      handleToolResponse: vi.fn(async () => ({
        response: '等待用户确认',
        assistantMessages: [],
        usages: [],
        interactive
      }))
    } as any);

    const answers = '{"q0":"A"}';
    const res = await runAgentCall({
      maxRunAgentTimes: 10,
      body: {
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        stream: false
      },
      usagePush: vi.fn(),
      isAborted: () => false,
      childrenInteractiveParams: suspend.interactiveResponse.params,
      handleInteractiveTool: vi.fn(async () => ({
        response: answers,
        assistantMessages: [],
        usages: []
      })),
      handleToolResponse: vi.fn(async () => ({ response: 'ok', assistantMessages: [], usages: [] }))
    } as any);

    expect(llmBodies.length).toBe(2);
    const toolMsg = llmBodies[1].messages.find(
      (m: any) => m.role === 'tool' && m.tool_call_id === 'c1'
    );
    expect(toolMsg.content).toBe(answers);
    expect(res.interactiveResponse).toBeUndefined();
  });
});
