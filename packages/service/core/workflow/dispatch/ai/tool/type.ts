import type { ChatCompletionMessageParam } from '@fastgpt/global/core/ai/llm/type';
import type { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import type { ModuleDispatchProps } from '@fastgpt/global/core/workflow/runtime/type';
import type { RuntimeNodeItemType } from '@fastgpt/global/core/workflow/runtime/type';
import type { DispatchFlowResponse } from '../../type';
import type { ChatItemMiniType } from '@fastgpt/global/core/chat/type';
import type { ToolCallChildrenInteractive } from '@fastgpt/global/core/workflow/template/system/interactive/type';
import type { LLMModelItemType } from '@fastgpt/global/core/ai/model.schema';
import type { JSONSchemaInputType } from '@fastgpt/global/core/app/jsonschema';
import type { AgentPlanType } from '@fastgpt/global/core/ai/agent/type';

export type DispatchToolModuleProps = ModuleDispatchProps<{
  [NodeInputKeyEnum.history]?: ChatItemMiniType[];
  [NodeInputKeyEnum.userChatInput]: string;

  [NodeInputKeyEnum.fileUrlList]?: string[];
  [NodeInputKeyEnum.aiModel]: string;
  [NodeInputKeyEnum.aiSystemPrompt]: string;
  [NodeInputKeyEnum.aiChatTemperature]: number;
  [NodeInputKeyEnum.aiChatMaxToken]: number;
  [NodeInputKeyEnum.aiChatIsResponseText]?: boolean;
  [NodeInputKeyEnum.aiChatVision]?: boolean;
  [NodeInputKeyEnum.aiChatReasoning]?: boolean;
  [NodeInputKeyEnum.aiChatTopP]?: number;
  [NodeInputKeyEnum.aiChatStopSign]?: string;
  [NodeInputKeyEnum.aiChatResponseFormat]?: string;
  [NodeInputKeyEnum.aiChatJsonSchema]?: string;
  [NodeInputKeyEnum.useAgentSandbox]?: boolean;
  [NodeInputKeyEnum.useAgentPlan]?: boolean;
  [NodeInputKeyEnum.toolPoolMode]?: boolean;
  [NodeInputKeyEnum.toolWhitelist]?: string[] | string;
  [NodeInputKeyEnum.inheritCallerModel]?: boolean;
  [NodeInputKeyEnum.directOutput]?: boolean;
}> & {
  messages: ChatCompletionMessageParam[];
  toolNodes: ToolNodeItemType[];
  toolModel: LLMModelItemType;
  childrenInteractiveParams?: ToolCallChildrenInteractive['params'];
  activePlan?: AgentPlanType;
  // 传递给子代理的工具池（poolMode 下为全池，≠ LLM 可见子集）
  childToolPool?: ToolNodeItemType[];
};

export type ToolNodeItemType = {
  nodeId: RuntimeNodeItemType['nodeId'];
  name: RuntimeNodeItemType['name'];
  avatar?: RuntimeNodeItemType['avatar'];
  intro?: RuntimeNodeItemType['intro'];
  toolDescription?: RuntimeNodeItemType['toolDescription'];
  flowNodeType: RuntimeNodeItemType['flowNodeType'];

  jsonSchema?: JSONSchemaInputType;
  toolParams: RuntimeNodeItemType['inputs'];
  // 工具池模式下仍保留在主节点 LLM 工具列表（成品工具直调通道）
  visibleToMain?: boolean;
};

export type ChildResponseItemType = {
  flowResponses: DispatchFlowResponse['flowResponses'];
  runTimes: DispatchFlowResponse['runTimes'];
  flowUsages: DispatchFlowResponse['flowUsages'];
};
