import {
  FlowNodeInputTypeEnum,
  FlowNodeOutputTypeEnum,
  FlowNodeTypeEnum
} from '../../node/constant';
import { type FlowNodeTemplateType } from '../../type/node';
import {
  WorkflowIOValueTypeEnum,
  NodeOutputKeyEnum,
  FlowNodeTemplateTypeEnum,
  NodeInputKeyEnum
} from '../../constants';
import {
  Input_Template_SettingAiModel,
  Input_Template_History,
  Input_Template_System_Prompt,
  Input_Template_UserChatInput,
  Input_Template_File_Link
} from '../input';
import { Output_Template_Error_Message } from '../output';
import { i18nT } from '../../../../../web/i18n/utils';

export const SubAgentNode: FlowNodeTemplateType = {
  id: FlowNodeTypeEnum.subAgent,
  flowNodeType: FlowNodeTypeEnum.subAgent,
  templateType: FlowNodeTemplateTypeEnum.ai,
  isTool: true,
  showSourceHandle: true,
  showTargetHandle: true,
  avatar: 'core/workflow/template/agent',
  avatarLinear: 'core/workflow/template/agentLinear',
  colorSchema: 'purple',
  name: i18nT('workflow:template.sub_agent'),
  intro: i18nT('workflow:template.sub_agent_intro'),
  showStatus: true,
  catchError: false,
  version: '4.14.31',
  inputs: [
    Input_Template_SettingAiModel,
    {
      key: NodeInputKeyEnum.inheritCallerModel,
      renderTypeList: [FlowNodeInputTypeEnum.switch],
      label: i18nT('workflow:sub_agent_inherit_model'),
      description: i18nT('workflow:sub_agent_inherit_model_desc'),
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: true
    },
    {
      key: NodeInputKeyEnum.useAgentPlan,
      renderTypeList: [FlowNodeInputTypeEnum.switch],
      label: i18nT('app:use_agent_plan'),
      description: i18nT('app:use_agent_plan_desc'),
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: false
    },
    {
      key: NodeInputKeyEnum.aiChatTemperature,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.number
    },
    {
      key: NodeInputKeyEnum.aiChatMaxToken,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.number
    },
    {
      key: NodeInputKeyEnum.aiChatIsResponseText,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      value: false,
      valueType: WorkflowIOValueTypeEnum.boolean
    },
    {
      key: NodeInputKeyEnum.aiChatVision,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: true
    },
    {
      key: NodeInputKeyEnum.aiChatReasoning,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: true
    },
    {
      key: NodeInputKeyEnum.aiChatTopP,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.number
    },
    {
      key: NodeInputKeyEnum.aiChatStopSign,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.string
    },
    {
      key: NodeInputKeyEnum.aiChatResponseFormat,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.string
    },
    {
      key: NodeInputKeyEnum.aiChatJsonSchema,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      label: '',
      valueType: WorkflowIOValueTypeEnum.string
    },
    {
      ...Input_Template_System_Prompt,
      toolDescription:
        'Complete system prompt for this sub-agent (role, tool-use strategy, boundaries, output format). Overrides its static default prompt. Optional: omit to use the static default.'
    },
    {
      ...Input_Template_History,
      value: 0
    },
    Input_Template_File_Link,
    {
      ...Input_Template_UserChatInput,
      toolDescription:
        'The task for this sub-agent. Must be self-contained: the sub-agent cannot see the main conversation history. Include background, inputs and expected output.'
    },
    {
      key: NodeInputKeyEnum.toolWhitelist,
      renderTypeList: [FlowNodeInputTypeEnum.textarea, FlowNodeInputTypeEnum.reference],
      valueType: WorkflowIOValueTypeEnum.arrayString,
      label: i18nT('workflow:sub_agent_tool_whitelist'),
      toolDescription:
        'Additional tool names (from the caller tool pool catalog) this sub-agent may use, on top of its own connected tools. Array of strings; empty = only its own connected tools. Match by name (case-insensitive) or node id.',
      required: false
    },
    {
      key: NodeInputKeyEnum.directOutput,
      renderTypeList: [FlowNodeInputTypeEnum.switch],
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: false,
      label: i18nT('workflow:sub_agent_direct_output'),
      description: i18nT('workflow:sub_agent_direct_output_desc'),
      toolDescription:
        'Output mode hook. true = send this sub-agent final answer to the user verbatim as the complete reply and end the loop (use ONLY for finished-product outputs). false/omit = result returns to you for integration (default).'
    }
  ],
  outputs: [
    {
      id: NodeOutputKeyEnum.answerText,
      key: NodeOutputKeyEnum.answerText,
      label: i18nT('common:core.module.output.label.Ai response content'),
      description: i18nT('common:core.module.output.description.Ai response content'),
      valueType: WorkflowIOValueTypeEnum.string,
      type: FlowNodeOutputTypeEnum.static
    },
    Output_Template_Error_Message
  ]
};
