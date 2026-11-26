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
import { READ_SKILL_NAME } from '@fastgpt/global/core/workflow/node/agent/readSkillTools';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';

const skillNode = (nodeId: string, name: string, body: string, intro = '简介') => ({
  nodeId,
  name,
  flowNodeType: FlowNodeTypeEnum.skill,
  isEntry: false,
  inputs: [{ key: 'system_textareaInput', valueType: 'string', value: body }],
  outputs: []
});

const buildProps = (over: any = {}) =>
  ({
    messages: [{ role: 'user', content: 'q' }],
    toolNodes: [],
    skillNodes: [
      {
        nodeId: 'sk1',
        name: '报销助手',
        intro: '报销流程',
        flowNodeType: FlowNodeTypeEnum.skill,
        toolParams: []
      }
    ],
    toolModel: { model: 'm', name: 'm', maxContext: 100000, toolChoice: true },
    runtimeNodes: [skillNode('sk1', '报销助手', '当前用户：{{username}}')],
    runtimeNodesMap: new Map(),
    variableState: { toRuntimeRecord: () => ({ username: '张三' }) },
    runtimeEdges: [],
    params: { isResponseAnswerText: false },
    checkIsStopping: () => false,
    requestOrigin: '',
    stream: false,
    externalProvider: {},
    workflowStreamResponse: vi.fn(),
    usagePush: vi.fn(),
    runningAppInfo: { id: 'a1', teamId: 't', tmbId: 'm', name: 'app' },
    uid: 'u',
    chatId: 'c',
    histories: [],
    ...over
  }) as any;

const callRead = (args: any) =>
  agentCaptured.handleToolResponse({
    call: {
      id: 'r1',
      type: 'function',
      function: { name: READ_SKILL_NAME, arguments: JSON.stringify(args) }
    },
    messages: []
  });

beforeEach(() => {
  workflowCaptured.length = 0;
  agentCaptured = {};
  workflowResponse = {};
});

describe('read_skill catalog tool', () => {
  it('exposes read_skill with enum catalog and required skill', async () => {
    await runToolCall(buildProps());
    const tool = agentCaptured.body.tools.find((t: any) => t.function.name === READ_SKILL_NAME);
    expect(tool).toBeTruthy();
    expect(tool.function.parameters.properties.skill.enum).toEqual(['报销助手']);
    expect(tool.function.parameters.required).toEqual(['skill']);
    expect(tool.function.description).toContain('报销助手: 报销流程');
    expect(agentCaptured.body.tools.some((t: any) => t.function.name === 'sk1')).toBe(false);
  });

  it('reads body with variable substitution and appends focus literally', async () => {
    await runToolCall(buildProps());
    const res = await callRead({ skill: '报销助手', focus: '差旅 {{username}}' });
    expect(res.response).toContain('已加载技能');
    expect(res.response).toContain('当前用户：张三');
    expect(res.response).toContain('【调用方关注】\n差旅 {{username}}');
    expect(res.stop).toBeFalsy();
    expect(res.interactive).toBeUndefined();
    expect(res.usages).toEqual([]);
    expect(workflowCaptured.length).toBe(0);
  });

  it('unknown name or missing skill returns catalog error without running workflow', async () => {
    await runToolCall(buildProps());
    const res = await callRead({ skill: '不存在' });
    expect(res.response).toContain('未找到');
    expect(res.response).toContain('报销助手');
    const res2 = await callRead({});
    expect(res2.response).toContain('参数无效');
    expect(workflowCaptured.length).toBe(0);
  });

  it('no skillNodes means no read_skill tool (v1 path untouched)', async () => {
    await runToolCall(buildProps({ skillNodes: [] }));
    expect(agentCaptured.body.tools.some((t: any) => t.function.name === READ_SKILL_NAME)).toBe(
      false
    );
  });

  it('empty body falls back to friendly error', async () => {
    await runToolCall(buildProps({ runtimeNodes: [skillNode('sk1', '报销助手', '   ')] }));
    const res = await callRead({ skill: '报销助手' });
    expect(res.response).toContain('为空');
  });

  it('duplicate names dedupe enum; nodeId matches exactly', async () => {
    await runToolCall(
      buildProps({
        skillNodes: [
          {
            nodeId: 'sk1',
            name: '同名',
            intro: 'a',
            flowNodeType: FlowNodeTypeEnum.skill,
            toolParams: []
          },
          {
            nodeId: 'sk2',
            name: '同名',
            intro: 'b',
            flowNodeType: FlowNodeTypeEnum.skill,
            toolParams: []
          }
        ],
        runtimeNodes: [skillNode('sk1', '同名', '正文A'), skillNode('sk2', '同名', '正文B')]
      })
    );
    const tool = agentCaptured.body.tools.find((t: any) => t.function.name === READ_SKILL_NAME);
    expect(tool.function.parameters.properties.skill.enum).toEqual(['同名']);
    const byId = await callRead({ skill: 'sk2' });
    expect(byId.response).toContain('正文B');
    const byName = await callRead({ skill: '同名' });
    expect(byName.response).toContain('正文A');
  });
});
