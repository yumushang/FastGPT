import {
  FlowNodeTemplateTypeEnum,
  NodeInputKeyEnum,
  WorkflowIOValueTypeEnum
} from '../../constants';
import { FlowNodeInputTypeEnum, FlowNodeTypeEnum } from '../../node/constant';
import { type FlowNodeTemplateType } from '../../type/node';
import { i18nT } from '../../../../../web/i18n/utils';

export const RunAppNode: FlowNodeTemplateType = {
  id: FlowNodeTypeEnum.appModule,
  templateType: FlowNodeTemplateTypeEnum.other,
  flowNodeType: FlowNodeTypeEnum.appModule,
  showSourceHandle: true,
  showTargetHandle: true,
  colorSchema: 'skyBlue',
  intro: '',
  name: '',
  showStatus: false,
  isTool: false,
  inputs: [
    {
      key: NodeInputKeyEnum.directOutput,
      renderTypeList: [FlowNodeInputTypeEnum.switch],
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: false,
      label: i18nT('app:direct_output'),
      description: i18nT('app:direct_output_desc'),
      toolDescription:
        'Output mode hook. true = send this workflow final answer to the user verbatim as the complete reply and end the loop (use ONLY for finished-product outputs, e.g. a pre-built workflow formatted reply). false/omit = result returns to you for integration (default).'
    },
    {
      key: NodeInputKeyEnum.visibleToMain,
      renderTypeList: [FlowNodeInputTypeEnum.switch],
      valueType: WorkflowIOValueTypeEnum.boolean,
      value: false,
      label: i18nT('app:visible_to_main'),
      description: i18nT('app:visible_to_main_desc')
    }
  ],
  outputs: []
};
