import { describe, expect, it, vi, beforeEach } from 'vitest';

const workflowCaptured: any[] = [];
let agentCaptured: any = {};
let workflowResponse: any = {};
let agentResponseExtra: any = {};

vi.mock('@fastgpt/service/core/workflow/dispatch', () => ({
  runWorkflow: vi.fn(async (props: any) => {
    workflowCaptured.push(props);
    return {
      toolResponses: '工具输出',
      assistantResponses: [],
      flowUsages: [],
      flowResponses: [],
      runTimes: 1,
      workflowInteractiveResponse: undefined,
      ...workflowResponse
    };
  })
}));
vi.mock('@fastgpt/service/core/ai/llm/agentCall', () => ({
  runAgentCall: vi.fn(async (props: any) => {
    agentCaptured = props;
    return {
      requestIds: [],
      completeMessages: [],
      assistantMessages: [],
      inputTokens: 0,
      outputTokens: 0,
      llmTotalPoints: 0,
      compressInputTokens: 0,
      compressOutputTokens: 0,
      childrenUsages: [],
      finish_reason: 'stop',
      ...agentResponseExtra
    };
  })
}));
vi.mock('@fastgpt/service/core/ai/sandbox/toolCall', () => ({
  callSandboxTool: vi.fn()
}));

import { runToolCall } from '@fastgpt/service/core/workflow/dispatch/ai/tool/toolCall';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';

const poolTool = {
  nodeId: 'poolA',
  name: '池工具A',
  flowNodeType: FlowNodeTypeEnum.skill,
  toolParams: []
};

const buildProps = (nodeDirectOutput = false, stream = false) =>
  ({
    messages: [{ role: 'user', content: 'q' }],
    toolNodes: [
      {
        nodeId: 'tool1',
        name: '工具1',
        flowNodeType: FlowNodeTypeEnum.skill,
        intro: '简介',
        toolParams: []
      }
    ],
    toolModel: { model: 'm', name: 'm', maxContext: 100000, toolChoice: true },
    childToolPool: [poolTool],
    runtimeNodes: [
      {
        nodeId: 'tool1',
        name: '工具1',
        flowNodeType: FlowNodeTypeEnum.skill,
        isEntry: false,
        inputs: [
          { key: 'directOutput', valueType: 'boolean', value: nodeDirectOutput },
          { key: 'userChatInput', valueType: 'string', value: '' }
        ],
        outputs: []
      }
    ],
    runtimeEdges: [],
    params: { isResponseAnswerText: false },
    checkIsStopping: () => false,
    requestOrigin: '',
    stream,
    externalProvider: {},
    workflowStreamResponse: vi.fn(),
    usagePush: vi.fn(),
    runningAppInfo: { id: 'a1', teamId: 't', tmbId: 'm', name: 'app' },
    uid: 'u',
    chatId: 'c',
    histories: []
  }) as any;

const callTool = (args: Record<string, any>) =>
  agentCaptured.handleToolResponse({
    call: {
      id: 'c1',
      type: 'function',
      function: { name: 'tool1', arguments: JSON.stringify(args) }
    },
    messages: []
  });

beforeEach(() => {
  workflowCaptured.length = 0;
  agentCaptured = {};
  workflowResponse = {};
  agentResponseExtra = {};
});

describe('runToolCall directOutput hook (read at call time)', () => {
  it('LLM arg true terminates loop and promotes response; passes pool/model down', async () => {
    const props = buildProps(false);
    await runToolCall(props);
    const res = await callTool({ directOutput: true });

    expect(res.stop).toBe(true);
    expect(res.terminalResponse).toBe('工具输出');
    expect(workflowCaptured[0].parentToolNodes).toEqual([poolTool]);
    expect(workflowCaptured[0].parentToolModel).toBe('m');
    expect(props.runtimeNodes[0].inputs.find((i: any) => i.key === 'directOutput').value).toBe(
      true
    );
    expect(props.workflowStreamResponse).not.toHaveBeenCalled();
  });

  it('omitted arg with node default false stays in summary mode', async () => {
    const props = buildProps(false);
    await runToolCall(props);
    const res = await callTool({});
    expect(res.stop).toBeFalsy();
    expect(res.terminalResponse).toBeUndefined();
  });

  it('node default true applies when arg omitted; arg false overrides', async () => {
    const props = buildProps(true);
    await runToolCall(props);
    const resDefault = await callTool({});
    expect(resDefault.terminalResponse).toBe('工具输出');

    workflowCaptured.length = 0;
    const resOverride = await callTool({ directOutput: false });
    expect(resOverride.terminalResponse).toBeUndefined();
    expect(resOverride.stop).toBeFalsy();
  });

  it('interactive response is not promoted', async () => {
    workflowResponse = { workflowInteractiveResponse: { type: 'userSelect', params: {} } };
    const props = buildProps(false);
    await runToolCall(props);
    const res = await callTool({ directOutput: true });
    expect(res.terminalResponse).toBeUndefined();
    expect(res.interactive).toBeTruthy();
  });

  it('runToolCall surfaces terminalResponse from agent loop', async () => {
    agentResponseExtra = { terminalResponse: '成品' };
    const res = await runToolCall(buildProps(false));
    expect(res.terminalResponse).toBe('成品');
  });
});

describe('runToolCall interactive resume restores LLM params', () => {
  it('restores directOutput/task from memory messages and promotes final answer', async () => {
    const props = buildProps(false);
    await runToolCall(props);

    const res = await agentCaptured.handleInteractiveTool({
      childrenResponse: { entryNodeIds: ['tool1'], type: 'userSelect', params: {} },
      toolParams: {
        toolCallId: 'c1',
        memoryRequestMessages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: 'tool1',
                  arguments: '{"directOutput":true,"userChatInput":"任务"}'
                }
              }
            ]
          }
        ]
      }
    });

    const inputs = props.runtimeNodes[0].inputs;
    expect(inputs.find((i: any) => i.key === 'directOutput').value).toBe(true);
    expect(inputs.find((i: any) => i.key === 'userChatInput').value).toBe('任务');
    expect(workflowCaptured[0].parentToolNodes).toEqual([poolTool]);
    expect(workflowCaptured[0].lastInteractive).toBeTruthy();
    expect(res.terminalResponse).toBe('工具输出');
    expect(res.stop).toBe(true);
  });
});

describe('directOutput silences child run (fastAnswer dedup)', () => {
  const resumeCall = (args: string) =>
    agentCaptured.handleInteractiveTool({
      childrenResponse: { entryNodeIds: ['tool1'], type: 'userSelect', params: {} },
      toolParams: {
        toolCallId: 'c1',
        memoryRequestMessages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'tool1', arguments: args } }
            ]
          }
        ]
      }
    });

  it('LLM arg true: child run silent, promotion unchanged', async () => {
    const props = buildProps(false, true);
    await runToolCall(props);
    const res = await callTool({ directOutput: true });
    expect(workflowCaptured[0].stream).toBe(false);
    expect(workflowCaptured[0].workflowStreamResponse).toBeUndefined();
    expect(res.terminalResponse).toBe('工具输出');
    expect(res.stop).toBe(true);
  });

  it('node default true with omitted arg silences child', async () => {
    const props = buildProps(true, true);
    await runToolCall(props);
    await callTool({});
    expect(workflowCaptured[0].stream).toBe(false);
    expect(workflowCaptured[0].workflowStreamResponse).toBeUndefined();
  });

  it('arg false overrides node true: passthrough unchanged', async () => {
    const props = buildProps(true, true);
    await runToolCall(props);
    await callTool({ directOutput: false });
    expect(workflowCaptured[0].stream).toBe(true);
    expect(workflowCaptured[0].workflowStreamResponse).toBe(props.workflowStreamResponse);
  });

  it('non-direct path passthrough unchanged', async () => {
    const props = buildProps(false, true);
    await runToolCall(props);
    await callTool({});
    expect(workflowCaptured[0].stream).toBe(true);
    expect(workflowCaptured[0].workflowStreamResponse).toBe(props.workflowStreamResponse);
  });

  it('suspend with directOutput: silent but interactive bubbles, no promotion', async () => {
    workflowResponse = { workflowInteractiveResponse: { type: 'userSelect', params: {} } };
    const props = buildProps(false, true);
    await runToolCall(props);
    const res = await callTool({ directOutput: true });
    expect(workflowCaptured[0].stream).toBe(false);
    expect(res.interactive).toBeTruthy();
    expect(res.terminalResponse).toBeUndefined();
  });

  it('resume with directOutput true silences child run', async () => {
    const props = buildProps(false, true);
    await runToolCall(props);
    const res = await resumeCall('{"directOutput":true}');
    expect(workflowCaptured[0].stream).toBe(false);
    expect(workflowCaptured[0].workflowStreamResponse).toBeUndefined();
    expect(workflowCaptured[0].lastInteractive).toBeTruthy();
    expect(res.terminalResponse).toBe('工具输出');
  });

  it('resume without directOutput passthrough', async () => {
    const props = buildProps(false, true);
    await runToolCall(props);
    await resumeCall('{}');
    expect(workflowCaptured[0].stream).toBe(true);
    expect(workflowCaptured[0].workflowStreamResponse).toBe(props.workflowStreamResponse);
  });
});
