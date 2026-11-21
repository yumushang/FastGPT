import { replaceVariable } from '@fastgpt/global/common/string/tools';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import type { ChildResponseItemType } from './type';
import { SANDBOX_TOOL_NAME } from '@fastgpt/global/core/ai/sandbox/constants';
import { i18nT } from '../../../../../../web/i18n/utils';

export const getMultiplePrompt = (obj: {
  fileCount: number;
  imgCount: number;
  question: string;
}) => {
  const prompt = `Number of session file inputs：
Document：{{fileCount}}
Image：{{imgCount}}
------
{{question}}`;
  return replaceVariable(prompt, obj);
};

export const getSandboxToolWorkflowResponse = ({
  name,
  logo,
  toolId = SANDBOX_TOOL_NAME,
  input,
  response,
  durationSeconds
}: {
  name: string;
  logo: string;
  toolId?: string;
  input: Record<string, any>;
  response: string;
  durationSeconds: number;
}): ChildResponseItemType => {
  return {
    flowResponses: [
      {
        moduleName: name,
        moduleType: FlowNodeTypeEnum.tool,
        moduleLogo: logo,
        toolId,
        toolInput: input,
        toolRes: response,
        totalPoints: 0,
        id: getNanoid(),
        nodeId: getNanoid(),
        runningTime: durationSeconds
      }
    ],
    flowUsages: [],
    runTimes: 0
  };
};

export const getPlanToolWorkflowResponse = ({
  callId,
  operation,
  message,
  seconds = 0
}: {
  callId: string;
  operation: 'set_plan' | 'update_plan';
  message: string;
  seconds?: number;
}): ChildResponseItemType => {
  return {
    flowResponses: [
      {
        moduleName: i18nT('chat:plan_update'),
        moduleType: FlowNodeTypeEnum.toolCall,
        moduleLogo: 'core/app/agent/child/plan',
        agentPlanStatus: operation,
        agentPlanResult: message,
        totalPoints: 0,
        id: callId,
        nodeId: callId,
        runningTime: seconds
      }
    ],
    flowUsages: [],
    runTimes: 0
  };
};
