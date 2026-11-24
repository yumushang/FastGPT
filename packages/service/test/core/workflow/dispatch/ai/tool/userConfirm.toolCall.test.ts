import { describe, expect, it, vi, beforeEach } from 'vitest';

const workflowCaptured: any[] = [];
let agentCaptured: any = {};
let workflowResponse: any = {};

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
      finish_reason: 'stop'
    };
  })
}));
vi.mock('@fastgpt/service/core/ai/sandbox/toolCall', () => ({
  callSandboxTool: vi.fn()
}));

import { runToolCall } from '@fastgpt/service/core/workflow/dispatch/ai/tool/toolCall';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { CONFIRM_TOOL_NAME } from '@fastgpt/global/core/workflow/node/agent/confirmTools';

const buildProps = (paramsOver: any = {}, query: any[] = []) =>
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
    runtimeNodes: [
      {
        nodeId: 'tool1',
        name: '工具1',
        flowNodeType: FlowNodeTypeEnum.skill,
        isEntry: false,
        inputs: [],
        outputs: []
      }
    ],
    runtimeEdges: [],
    query,
    params: { isResponseAnswerText: false, ...paramsOver },
    checkIsStopping: () => false,
    requestOrigin: '',
    stream: false,
    externalProvider: {},
    workflowStreamResponse: vi.fn(),
    usagePush: vi.fn(),
    runningAppInfo: { id: 'a1', teamId: 't', tmbId: 'm', name: 'app' },
    uid: 'u',
    chatId: 'c',
    histories: []
  }) as any;

const confirmArgs = {
  questions: [
    { question: '是否继续？', options: ['继续', '取消'] },
    { question: '选择范围', options: ['A', 'B', 'C'], multiple: true },
    { question: '补充说明' }
  ]
};

const callConfirm = (args: any = confirmArgs, id = 'c1') =>
  agentCaptured.handleToolResponse({
    call: {
      id,
      type: 'function',
      function: { name: CONFIRM_TOOL_NAME, arguments: JSON.stringify(args) }
    },
    messages: []
  });

beforeEach(() => {
  workflowCaptured.length = 0;
  agentCaptured = {};
  workflowResponse = {};
});

describe('user_confirm suspend intercept', () => {
  it('synthesizes userInput interactive with flat radio/checkbox/input fields', async () => {
    await runToolCall(buildProps());
    const res = await callConfirm();
    expect(res.interactive.type).toBe('userInput');
    const form = res.interactive.params.inputForm;
    expect(form.map((f: any) => f.type)).toEqual(['radio', 'checkbox', 'input']);
    expect(form.map((f: any) => f.key)).toEqual(['q0', 'q1', 'q2']);
    expect(form[0].valueType).toBe('string');
    expect(form[1].valueType).toBe('arrayString');
    expect(form[1].value).toEqual([]);
    expect(form[0].list).toEqual([
      { label: '继续', value: '继续' },
      { label: '取消', value: '取消' }
    ]);
    expect(form.every((f: any) => f.allowCustom === true && f.required === true)).toBe(true);
    expect(res.interactive.entryNodeIds).toEqual([CONFIRM_TOOL_NAME]);
    expect(res.interactive.memoryEdges).toEqual([]);
    expect(res.interactive.nodeOutputs).toEqual([]);
    expect(res.response).toContain('等待用户确认');
    expect(workflowCaptured.length).toBe(0);
  });

  it('marks confirmCard and carries option descriptions', async () => {
    await runToolCall(buildProps());
    const res = await callConfirm({
      questions: [{ question: 'Q', options: [{ label: '甲', description: '说明甲' }, '乙'] }]
    });
    expect(res.interactive.params.confirmCard).toBe(true);
    expect(res.interactive.params.inputForm[0].list).toEqual([
      { label: '甲', value: '甲', description: '说明甲' },
      { label: '乙', value: '乙' }
    ]);
  });

  it('invalid args do not suspend', async () => {
    await runToolCall(buildProps());
    const res = await callConfirm({ questions: [] });
    expect(res.interactive).toBeUndefined();
    expect(res.response).toContain('无效');
    const res2 = await callConfirm({ questions: [{ question: '   ' }] });
    expect(res2.interactive).toBeUndefined();
  });

  it('normalizes options (trim/dedupe/cap 8)', async () => {
    await runToolCall(buildProps());
    const res = await callConfirm({
      questions: [
        { question: 'Q', options: [' a ', 'a', '', 'b', '1', '2', '3', '4', '5', '6', '7', '8'] }
      ]
    });
    const list = res.interactive.params.inputForm[0].list;
    expect(list.map((i: any) => i.value)).toEqual(['a', 'b', '1', '2', '3', '4', '5', '6']);
  });

  it('second confirm in same round is guarded', async () => {
    await runToolCall(buildProps());
    const first = await callConfirm(confirmArgs, 'c1');
    expect(first.interactive).toBeDefined();
    const second = await callConfirm(confirmArgs, 'c2');
    expect(second.interactive).toBeUndefined();
    expect(second.response).toContain('待处理交互');
  });

  it('switch off removes tool; undefined keeps it', async () => {
    await runToolCall(buildProps({ useUserConfirm: false }));
    expect(agentCaptured.body.tools.some((t: any) => t.function.name === CONFIRM_TOOL_NAME)).toBe(
      false
    );
    await runToolCall(buildProps());
    expect(agentCaptured.body.tools.some((t: any) => t.function.name === CONFIRM_TOOL_NAME)).toBe(
      true
    );
  });
});

describe('user_confirm resume intercept', () => {
  const memory = (args: any = confirmArgs) => [
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: CONFIRM_TOOL_NAME, arguments: JSON.stringify(args) }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: '等待用户确认' }
  ];

  it('returns parsed answers without running workflow', async () => {
    const answers = { q0: '继续', q1: ['A', 'B'], q2: '自定义说明' };
    await runToolCall(buildProps({}, [{ text: { content: JSON.stringify(answers) } }]));
    const res = await agentCaptured.handleInteractiveTool({
      childrenResponse: { type: 'userInput', params: {}, entryNodeIds: [CONFIRM_TOOL_NAME] },
      toolParams: { toolCallId: 'c1', memoryRequestMessages: memory() }
    });
    expect(JSON.parse(res.response)).toEqual(answers);
    expect(res.assistantMessages).toEqual([]);
    expect(workflowCaptured.length).toBe(0);
  });

  it('empty answers or bad JSON return error text without suspending', async () => {
    await runToolCall(buildProps({}, [{ text: { content: '{}' } }]));
    const res = await agentCaptured.handleInteractiveTool({
      childrenResponse: { type: 'userInput', params: {}, entryNodeIds: [CONFIRM_TOOL_NAME] },
      toolParams: { toolCallId: 'c1', memoryRequestMessages: memory() }
    });
    expect(res.response).toContain('未提供有效答案');
    expect(res.interactive).toBeUndefined();

    await runToolCall(buildProps({}, [{ text: { content: 'not-json' } }]));
    const res2 = await agentCaptured.handleInteractiveTool({
      childrenResponse: { type: 'userInput', params: {}, entryNodeIds: [CONFIRM_TOOL_NAME] },
      toolParams: { toolCallId: 'c1', memoryRequestMessages: memory() }
    });
    expect(res2.response).toContain('未提供有效答案');
  });

  it('skip signal returns continue notice without suspending', async () => {
    await runToolCall(buildProps({}, [{ text: { content: JSON.stringify({ skip: true }) } }]));
    const res = await agentCaptured.handleInteractiveTool({
      childrenResponse: { type: 'userInput', params: {}, entryNodeIds: [CONFIRM_TOOL_NAME] },
      toolParams: { toolCallId: 'c1', memoryRequestMessages: memory() }
    });
    expect(res.response).toContain('跳过');
    expect(res.interactive).toBeUndefined();
    expect(workflowCaptured.length).toBe(0);
  });

  it('canvas nodeId resume still runs workflow (regression)', async () => {
    await runToolCall(buildProps({}, [{ text: { content: '选择' } }]));
    const res = await agentCaptured.handleInteractiveTool({
      childrenResponse: { type: 'userSelect', params: {}, entryNodeIds: ['tool1'] },
      toolParams: {
        toolCallId: 'c9',
        memoryRequestMessages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c9', type: 'function', function: { name: 'tool1', arguments: '{}' } }
            ]
          }
        ]
      }
    });
    expect(workflowCaptured.length).toBe(1);
    expect(res.response).toBe('工具输出');
  });
});
