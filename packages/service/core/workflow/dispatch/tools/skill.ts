import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import type {
  ModuleDispatchProps,
  DispatchNodeResultType
} from '@fastgpt/global/core/workflow/runtime/type';
import { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { replaceVariable } from '@fastgpt/global/common/string/tools';

type Props = ModuleDispatchProps<{
  [NodeInputKeyEnum.textareaInput]: string;
}>;
type Response = DispatchNodeResultType<{
  [NodeOutputKeyEnum.text]: string;
}>;

export const dispatchSkill = (props: Record<string, any>): Response => {
  const {
    node,
    variableState,
    params: { [NodeInputKeyEnum.textareaInput]: text = '' }
  } = props as Props;

  const content = replaceVariable(text, variableState.toRuntimeRecord());

  if (!content.trim()) {
    return {
      data: { [NodeOutputKeyEnum.text]: '' },
      [DispatchNodeResponseKeyEnum.toolResponses]: `技能「${node.name}」的指令正文为空，请先在节点中填写技能指令。`
    };
  }

  return {
    data: { [NodeOutputKeyEnum.text]: content },
    [DispatchNodeResponseKeyEnum.nodeResponse]: { textOutput: content },
    [DispatchNodeResponseKeyEnum.toolResponses]: `已加载技能「${node.name}」。请严格按照以下技能指令处理当前任务：\n\n${content}`
  };
};
