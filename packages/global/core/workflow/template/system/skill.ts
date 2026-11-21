import {
  FlowNodeInputTypeEnum,
  FlowNodeOutputTypeEnum,
  FlowNodeTypeEnum
} from '../../node/constant';
import { type FlowNodeTemplateType } from '../../type/node';
import {
  WorkflowIOValueTypeEnum,
  NodeOutputKeyEnum,
  NodeInputKeyEnum,
  FlowNodeTemplateTypeEnum
} from '../../constants';
import { i18nT } from '../../../../../web/i18n/utils';

export const SkillNode: FlowNodeTemplateType = {
  id: FlowNodeTypeEnum.skill,
  templateType: FlowNodeTemplateTypeEnum.tools,
  flowNodeType: FlowNodeTypeEnum.skill,
  isTool: true,
  showSourceHandle: true,
  showTargetHandle: true,
  avatar: 'core/skill/default',
  avatarLinear: 'core/skill/default',
  colorSchema: 'purple',
  name: i18nT('workflow:skill_node'),
  intro: i18nT('workflow:intro_skill_node'),
  inputs: [
    {
      key: NodeInputKeyEnum.textareaInput,
      renderTypeList: [FlowNodeInputTypeEnum.textarea],
      valueType: WorkflowIOValueTypeEnum.string,
      required: true,
      label: i18nT('workflow:skill_content'),
      placeholder: i18nT('workflow:skill_content_placeholder')
    }
  ],
  outputs: [
    {
      id: NodeOutputKeyEnum.text,
      key: NodeOutputKeyEnum.text,
      label: i18nT('workflow:skill_output'),
      type: FlowNodeOutputTypeEnum.static,
      valueType: WorkflowIOValueTypeEnum.string
    }
  ]
};
