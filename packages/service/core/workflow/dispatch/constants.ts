import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { dispatchAppRequest } from './abandoned/runApp';
import { dispatchLoop } from './abandoned/runLoop';
import { dispatchClassifyQuestion } from './ai/classifyQuestion';
import { dispatchContentExtract } from './ai/extract';
import { dispatchRunTools } from './ai/tool/index';
import { dispatchStopToolCall } from './ai/tool/stopTool';
import { dispatchToolParams } from './ai/tool/toolParams';
import { dispatchChatCompletion } from './ai/chat';
import { dispatchCodeSandbox } from './tools/codeSandbox';
import { dispatchDatasetConcat } from './dataset/concat';
import { dispatchDatasetSearch } from './dataset/search';
import { dispatchSystemConfig } from './init/systemConfig';
import { dispatchWorkflowStart } from './init/workflowStart';
import { dispatchFormInput } from './interactive/formInput';
import { dispatchUserSelect } from './interactive/userSelect';
import { dispatchLoopEnd } from './loop/runLoopEnd';
import { dispatchLoopStart } from './loop/runLoopStart';
import { dispatchParallelRun } from './parallelRun/runParallelRun';
import { dispatchLoopRun } from './loopRun/runLoopRun';
import { dispatchLoopRunStart } from './loopRun/runLoopRunStart';
import { dispatchLoopRunBreak } from './loopRun/runLoopRunBreak';
import { dispatchRunPlugin } from './plugin/run';
import { dispatchRunAppNode } from './child/runApp';
import { dispatchPluginInput } from './plugin/runInput';
import { dispatchPluginOutput } from './plugin/runOutput';
import { dispatchRunTool } from './child/runTool';
import { dispatchAnswer } from './tools/answer';
import { dispatchCustomFeedback } from './tools/customFeedback';
import { dispatchHttp468Request } from './tools/http468';
import { dispatchQueryExtension } from './tools/queryExternsion';
import { dispatchReadFiles } from './tools/readFiles';
import { dispatchIfElse } from './tools/runIfElse';
import { dispatchLafRequest } from './tools/runLaf';
import { dispatchUpdateVariable } from './tools/runUpdateVar';
import { dispatchTextEditor } from './tools/textEditor';
import { dispatchRunAgent } from './ai/agent';

export const callbackMap: Record<FlowNodeTypeEnum, Function> = {
  [FlowNodeTypeEnum.workflowStart]: dispatchWorkflowStart,

  // Child
  [FlowNodeTypeEnum.appModule]: dispatchRunAppNode,
  [FlowNodeTypeEnum.pluginModule]: dispatchRunPlugin,
  [FlowNodeTypeEnum.pluginInput]: dispatchPluginInput,
  [FlowNodeTypeEnum.pluginOutput]: dispatchPluginOutput,

  // AI
  [FlowNodeTypeEnum.agent]: dispatchRunAgent,
  [FlowNodeTypeEnum.chatNode]: dispatchChatCompletion,
  [FlowNodeTypeEnum.datasetSearchNode]: dispatchDatasetSearch,
  [FlowNodeTypeEnum.classifyQuestion]: dispatchClassifyQuestion,
  [FlowNodeTypeEnum.contentExtract]: dispatchContentExtract,
  [FlowNodeTypeEnum.queryExtension]: dispatchQueryExtension,
  // Tool call
  [FlowNodeTypeEnum.toolCall]: dispatchRunTools,
  [FlowNodeTypeEnum.stopTool]: dispatchStopToolCall,
  [FlowNodeTypeEnum.toolParams]: dispatchToolParams,

  [FlowNodeTypeEnum.answerNode]: dispatchAnswer,
  [FlowNodeTypeEnum.datasetConcatNode]: dispatchDatasetConcat,
  [FlowNodeTypeEnum.httpRequest468]: dispatchHttp468Request,
  [FlowNodeTypeEnum.lafModule]: dispatchLafRequest,
  [FlowNodeTypeEnum.ifElseNode]: dispatchIfElse,
  [FlowNodeTypeEnum.variableUpdate]: dispatchUpdateVariable,
  [FlowNodeTypeEnum.code]: dispatchCodeSandbox,
  [FlowNodeTypeEnum.textEditor]: dispatchTextEditor,
  [FlowNodeTypeEnum.customFeedback]: dispatchCustomFeedback,
  [FlowNodeTypeEnum.readFiles]: dispatchReadFiles,
  [FlowNodeTypeEnum.userSelect]: dispatchUserSelect,
  [FlowNodeTypeEnum.parallelRun]: dispatchParallelRun,
  [FlowNodeTypeEnum.loopRun]: dispatchLoopRun,
  [FlowNodeTypeEnum.loopRunStart]: dispatchLoopRunStart,
  [FlowNodeTypeEnum.loopRunBreak]: dispatchLoopRunBreak,
  [FlowNodeTypeEnum.nestedStart]: dispatchLoopStart,
  [FlowNodeTypeEnum.nestedEnd]: dispatchLoopEnd,
  [FlowNodeTypeEnum.formInput]: dispatchFormInput,
  [FlowNodeTypeEnum.tool]: dispatchRunTool,

  // none
  [FlowNodeTypeEnum.systemConfig]: dispatchSystemConfig,
  [FlowNodeTypeEnum.pluginConfig]: () => Promise.resolve(),
  [FlowNodeTypeEnum.emptyNode]: () => Promise.resolve(),
  [FlowNodeTypeEnum.globalVariable]: () => Promise.resolve(),
  [FlowNodeTypeEnum.comment]: () => Promise.resolve(),
  [FlowNodeTypeEnum.toolSet]: () => Promise.resolve(),

  /** @deprecated */
  [FlowNodeTypeEnum.runApp]: dispatchAppRequest,
  /** @deprecated 已被 loopRun 替代 */
  [FlowNodeTypeEnum.loop]: dispatchLoop
};

export const FlowNodeTypeResTextMap: Record<FlowNodeTypeEnum, string> = {
  [FlowNodeTypeEnum.workflowStart]: '',
  [FlowNodeTypeEnum.answerNode]: 'textOutput',
  [FlowNodeTypeEnum.chatNode]: '',
  [FlowNodeTypeEnum.datasetSearchNode]: 'quoteList',
  [FlowNodeTypeEnum.datasetConcatNode]: 'concatLength',
  [FlowNodeTypeEnum.classifyQuestion]: 'cqResult',
  [FlowNodeTypeEnum.contentExtract]: 'extractResult',
  [FlowNodeTypeEnum.httpRequest468]: 'httpResult',
  [FlowNodeTypeEnum.appModule]: '',
  [FlowNodeTypeEnum.pluginModule]: '',
  [FlowNodeTypeEnum.pluginInput]: '',
  [FlowNodeTypeEnum.pluginOutput]: 'pluginOutput',
  [FlowNodeTypeEnum.queryExtension]: 'queryExtensionResult',
  [FlowNodeTypeEnum.agent]: '',
  [FlowNodeTypeEnum.stopTool]: '',
  [FlowNodeTypeEnum.toolParams]: 'toolParamsResult',
  [FlowNodeTypeEnum.lafModule]: '',
  [FlowNodeTypeEnum.ifElseNode]: 'ifElseResult',
  [FlowNodeTypeEnum.variableUpdate]: 'updateVarResult',
  [FlowNodeTypeEnum.code]: 'customOutputs',
  [FlowNodeTypeEnum.textEditor]: 'textOutput',
  [FlowNodeTypeEnum.customFeedback]: 'customOutputs',
  [FlowNodeTypeEnum.readFiles]: 'readFiles',
  [FlowNodeTypeEnum.userSelect]: 'userSelectResult',
  [FlowNodeTypeEnum.loop]: 'loopResult',
  [FlowNodeTypeEnum.loopStart]: 'loopInputValue',
  [FlowNodeTypeEnum.loopEnd]: 'loopOutputValue',
  [FlowNodeTypeEnum.formInput]: 'formInputResult',
  [FlowNodeTypeEnum.tool]: 'toolRes',
  [FlowNodeTypeEnum.toolCall]: 'toolRes', // todo 需要确定

  [FlowNodeTypeEnum.systemConfig]: '',
  [FlowNodeTypeEnum.pluginConfig]: '',
  [FlowNodeTypeEnum.emptyNode]: '',
  [FlowNodeTypeEnum.globalVariable]: '',
  [FlowNodeTypeEnum.comment]: '',
  [FlowNodeTypeEnum.toolSet]: '',

  [FlowNodeTypeEnum.runApp]: ''
};
