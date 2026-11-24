import { describe, expect, it, vi, beforeEach } from 'vitest';

const captured: any[] = [];
let scripted: any = {};

vi.mock('@fastgpt/service/core/workflow/dispatch/ai/tool/toolCall', () => ({
  runToolCall: vi.fn(async (props: any) => {
    captured.push(props);
    return {
      requestIds: [],
      toolDispatchFlowResponses: [],
      toolCallInputTokens: 0,
      toolCallOutputTokens: 0,
      toolCallTotalPoints: 0,
      completeMessages: [],
      assistantResponses: [{ text: { content: '子终答' } }],
      finish_reason: 'stop',
      ...scripted
    };
  })
}));
vi.mock('@fastgpt/service/core/ai/model', () => ({
  getLLMModel: vi.fn((m?: string) => ({
    model: m || 'system-default',
    name: m || 'system-default',
    maxContext: 100000,
    toolChoice: true
  }))
}));
vi.mock('@fastgpt/service/core/workflow/dispatch/utils', () => ({
  filterToolNodeIdByEdges: ({ nodeId, edges }: any) =>
    edges
      .filter((e: any) => e.source === nodeId && e.targetHandle === 'selectedTools')
      .map((e: any) => e.target),
  getNodeErrResponse: ({ error }: any) => ({
    toolResponses: { error: String(error) },
    error: String(error)
  }),
  getHistories: (n: number, h: any[]) => (n <= 0 ? [] : h.slice(-n))
}));
vi.mock('@fastgpt/service/core/workflow/dispatch/tools/readFiles', () => ({
  getFileContentFromLinks: vi.fn(async () => ({ text: '' })),
  getHistoryFileLinks: vi.fn(() => [])
}));
vi.mock('@fastgpt/service/core/chat/postTextCensor', () => ({
  postTextCensor: vi.fn()
}));
vi.mock('@fastgpt/web/i18n/utils', () => ({
  i18nT: vi.fn((key: string) => key)
}));

import { dispatchRunTools } from '@fastgpt/service/core/workflow/dispatch/ai/tool/index';
import { SubAgentNode } from '@fastgpt/global/core/workflow/template/system/subAgent';
import { getToolConfigStatus } from '@fastgpt/global/core/app/formEdit/utils';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';

const rtTool = (nodeId: string, name: string, flowNodeType = FlowNodeTypeEnum.skill) => ({
  nodeId,
  name,
  flowNodeType,
  avatar: '',
  intro: `${name}简介`,
  inputs: [
    {
      key: NodeInputKeyEnum.textareaInput,
      renderTypeList: ['textarea'],
      valueType: 'string',
      required: true,
      value: '正文'
    }
  ],
  outputs: []
});

const toolEdge = (source: string, target: string) => ({
  source,
  target,
  sourceHandle: 'selectedTools',
  targetHandle: 'selectedTools',
  status: 'active'
});

const baseProps = (over: any = {}) => ({
  node: {
    nodeId: 'node1',
    name: '节点',
    flowNodeType: FlowNodeTypeEnum.toolCall,
    inputs: [],
    isEntry: true
  },
  runtimeNodes: [],
  runtimeEdges: [],
  histories: [],
  query: [],
  chatConfig: {},
  runningAppInfo: { id: 'app1', teamId: 't1', tmbId: 'm1', name: 'app' },
  runningUserInfo: {
    username: 'u',
    teamName: 't',
    memberName: 'm',
    contact: '',
    teamId: 't1',
    tmbId: 'm1'
  },
  uid: 'u1',
  chatId: 'c1',
  variableState: { toRuntimeRecord: () => ({}), toStoreRecord: () => ({}) },
  workflowStreamResponse: vi.fn(),
  usagePush: vi.fn(),
  params: {
    model: 'main-model',
    systemPrompt: '静态人设',
    userChatInput: '任务',
    history: 6
  },
  ...over
});

const systemContent = (props: any) => {
  const sys = props.messages.find((m: any) => m.role === 'system');
  return typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content);
};

beforeEach(() => {
  captured.length = 0;
  scripted = {};
});

describe('SubAgentNode template', () => {
  it('is a tool with isolated context, silent streaming and LLM-facing params', () => {
    expect(SubAgentNode.isTool).toBe(true);
    const byKey = Object.fromEntries(SubAgentNode.inputs.map((i) => [i.key, i]));
    expect(byKey[NodeInputKeyEnum.history].value).toBe(0);
    expect(byKey[NodeInputKeyEnum.aiChatIsResponseText].value).toBe(false);
    expect(byKey[NodeInputKeyEnum.inheritCallerModel].value).toBe(true);
    expect(byKey[NodeInputKeyEnum.aiSystemPrompt].toolDescription).toBeTruthy();
    expect(byKey[NodeInputKeyEnum.userChatInput].toolDescription).toBeTruthy();
    expect(byKey[NodeInputKeyEnum.toolWhitelist].toolDescription).toBeTruthy();
    expect(byKey[NodeInputKeyEnum.directOutput].toolDescription).toBeTruthy();
    expect(getToolConfigStatus({ tool: SubAgentNode }).status).toBe('configured');
  });
});

describe('dispatchRunTools subAgent branch', () => {
  const subNode = rtTool('sub1', '财务子代理', FlowNodeTypeEnum.subAgent);
  const own = rtTool('own1', '财务:域内工具');
  const poolA = {
    nodeId: 'idA',
    name: '财务:报销',
    flowNodeType: FlowNodeTypeEnum.skill,
    intro: '报销',
    toolParams: []
  };
  const poolB = {
    nodeId: 'idB',
    name: '人事:请假',
    flowNodeType: FlowNodeTypeEnum.skill,
    intro: '请假',
    toolParams: []
  };

  const subProps = (over: any = {}) =>
    baseProps({
      node: { ...subNode, isEntry: true },
      runtimeNodes: [subNode, own],
      runtimeEdges: [toolEdge('sub1', 'own1')],
      parentToolNodes: [poolA, poolB],
      parentToolModel: 'caller-model',
      params: { model: 'main-model', systemPrompt: '静态人设', userChatInput: '任务', history: 0 },
      ...over
    });

  it('merges own-edge tools with whitelist additions and inherits caller model', async () => {
    await dispatchRunTools(
      subProps({
        params: {
          model: 'main-model',
          systemPrompt: '静态人设',
          userChatInput: '任务',
          history: 0,
          toolWhitelist: ['财务:报销']
        }
      }) as any
    );
    const p = captured[0];
    expect(p.toolNodes.map((t: any) => t.nodeId)).toEqual(['own1', 'idA']);
    expect(p.childToolPool.map((t: any) => t.nodeId)).toEqual(['own1', 'idA']);
    expect(p.toolModel.model).toBe('caller-model');
  });

  it('empty whitelist keeps only own-edge tools', async () => {
    await dispatchRunTools(subProps() as any);
    expect(captured[0].toolNodes.map((t: any) => t.nodeId)).toEqual(['own1']);
  });

  it('whitelist misses are noted but not fatal when own tools exist', async () => {
    await dispatchRunTools(
      subProps({
        params: {
          model: 'm',
          systemPrompt: '静态人设',
          userChatInput: '任务',
          history: 0,
          toolWhitelist: ['不存在']
        }
      }) as any
    );
    expect(captured[0].toolNodes.map((t: any) => t.nodeId)).toEqual(['own1']);
    expect(systemContent(captured[0])).toContain('不存在');
    expect(systemContent(captured[0])).toContain('已忽略');
  });

  it('errors with available pool names when no tools at all', async () => {
    const res: any = await dispatchRunTools(
      baseProps({
        node: { ...subNode, isEntry: true },
        runtimeNodes: [subNode],
        runtimeEdges: [],
        parentToolNodes: [poolA],
        params: {
          model: 'm',
          systemPrompt: '',
          userChatInput: '任务',
          history: 0,
          toolWhitelist: ['不存在'],
          useUserConfirm: false
        }
      }) as any
    );
    expect(res.toolResponses.error).toContain('财务:报销');
    expect(captured.length).toBe(0);
  });

  it('bare subAgent still runs when confirm tool enabled (default)', async () => {
    const res: any = await dispatchRunTools(
      baseProps({
        node: { ...subNode, isEntry: true },
        runtimeNodes: [subNode],
        runtimeEdges: [],
        parentToolNodes: [poolA],
        params: { model: 'm', systemPrompt: '', userChatInput: '任务', history: 0 }
      }) as any
    );
    expect(res.toolResponses?.error).toBeUndefined();
    expect(captured.length).toBe(1);
    expect(captured[0].toolNodes).toEqual([]);
  });

  it('overrides system prompt and keeps context isolated (history=0)', async () => {
    await dispatchRunTools(
      subProps({
        histories: [{ obj: 'Human', value: [{ text: { content: '旧对话' } }] }],
        params: { model: 'm', systemPrompt: '动态人设', userChatInput: '任务', history: 0 }
      }) as any
    );
    const p = captured[0];
    expect(systemContent(p)).toContain('动态人设');
    expect(p.messages.length).toBe(2);
    expect(JSON.stringify(p.messages)).not.toContain('旧对话');
  });

  it('inheritCallerModel=false uses own model', async () => {
    await dispatchRunTools(
      subProps({
        params: {
          model: 'own-model',
          systemPrompt: '',
          userChatInput: '任务',
          history: 0,
          inheritCallerModel: false
        }
      }) as any
    );
    expect(captured[0].toolModel.model).toBe('own-model');
  });

  it('returns answerText as toolResponses (nested tool result fix)', async () => {
    const res: any = await dispatchRunTools(subProps() as any);
    expect(res.toolResponses).toBe('子终答');
    expect(res.data.answerText).toBe('子终答');
  });

  it('promotes terminalResponse to final reply with fastAnswer', async () => {
    scripted = { terminalResponse: '成品原文' };
    const props = subProps();
    const res: any = await dispatchRunTools(props as any);
    expect(res.data.answerText).toBe('成品原文');
    expect(res.toolResponses).toBe('成品原文');
    expect(res.assistantResponses).toEqual([{ text: { content: '成品原文' } }]);
    expect(props.workflowStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fastAnswer' })
    );
  });
});

describe('dispatchRunTools poolMode (main node)', () => {
  const sub = rtTool('sub1', '财务子代理', FlowNodeTypeEnum.subAgent);
  const t1 = rtTool('idA', '财务:报销');
  const t2 = rtTool('idB', '人事:请假');
  const mainProps = (poolMode: boolean) =>
    baseProps({
      runtimeNodes: [sub, t1, t2],
      runtimeEdges: [toolEdge('node1', 'sub1'), toolEdge('node1', 'idA'), toolEdge('node1', 'idB')],
      params: {
        model: 'm',
        systemPrompt: '主提示词',
        userChatInput: '问题',
        history: 6,
        toolPoolMode: poolMode
      }
    });

  it('poolMode exposes only sub-agents and injects catalog', async () => {
    await dispatchRunTools(mainProps(true) as any);
    const p = captured[0];
    expect(p.toolNodes.map((t: any) => t.nodeId)).toEqual(['sub1']);
    expect(p.childToolPool.map((t: any) => t.nodeId)).toEqual(['sub1', 'idA', 'idB']);
    const sys = systemContent(p);
    expect(sys).toContain('工具池目录');
    expect(sys).toContain('名称: 财务:报销 | id: idA');
    expect(sys).toContain('directOutput');
  });

  it('poolMode off keeps all tools (zero impact)', async () => {
    await dispatchRunTools(mainProps(false) as any);
    const p = captured[0];
    expect(p.toolNodes.length).toBe(3);
    expect(systemContent(p)).not.toContain('工具池目录');
  });

  it('poolMode without sub-agent degrades to all tools', async () => {
    const props = baseProps({
      runtimeNodes: [t1, t2],
      runtimeEdges: [toolEdge('node1', 'idA'), toolEdge('node1', 'idB')],
      params: {
        model: 'm',
        systemPrompt: '',
        userChatInput: '问题',
        history: 6,
        toolPoolMode: true
      }
    });
    await dispatchRunTools(props as any);
    expect(captured[0].toolNodes.length).toBe(2);
  });

  it('visibleToMain finished tool stays in main tools and out of catalog', async () => {
    const finished = {
      ...rtTool('idC', '成品报告'),
      inputs: [
        ...rtTool('idC', '成品报告').inputs,
        { key: 'visibleToMain', renderTypeList: ['switch'], valueType: 'boolean', value: true },
        { key: 'directOutput', renderTypeList: ['switch'], valueType: 'boolean', value: true }
      ]
    };
    const props = baseProps({
      runtimeNodes: [sub, t1, finished],
      runtimeEdges: [toolEdge('node1', 'sub1'), toolEdge('node1', 'idA'), toolEdge('node1', 'idC')],
      params: {
        model: 'm',
        systemPrompt: '主提示词',
        userChatInput: '问题',
        history: 6,
        toolPoolMode: true
      }
    });
    await dispatchRunTools(props as any);
    const p = captured[0];
    expect(p.toolNodes.map((t: any) => t.nodeId)).toEqual(['sub1', 'idC']);
    const sys = systemContent(p);
    expect(sys).toContain('名称: 财务:报销 | id: idA');
    expect(sys).not.toContain('成品报告');
  });
});
