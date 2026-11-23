import { FlowNodeTemplateTypeEnum } from '../../constants';
import { FlowNodeTypeEnum } from '../../node/constant';
import { type FlowNodeTemplateType } from '../../type/node';
import { Input_Template_DirectOutput, Input_Template_VisibleToMain } from '../input';

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
  inputs: [Input_Template_DirectOutput, Input_Template_VisibleToMain],
  outputs: []
};
