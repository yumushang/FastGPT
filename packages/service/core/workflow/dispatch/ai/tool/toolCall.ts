import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  CompletionFinishReason
} from '@fastgpt/global/core/ai/llm/type';
import { SseResponseEventEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { textAdaptGptResponse } from '@fastgpt/global/core/workflow/runtime/utils';
import { runWorkflow } from '../../index';
import type { ChildResponseItemType, DispatchToolModuleProps, ToolNodeItemType } from './type';
import { chats2GPTMessages, GPTMessages2Chats } from '@fastgpt/global/core/chat/adapt';
import type { AIChatItemValueItemType } from '@fastgpt/global/core/chat/type';
import { formatToolResponse, initToolCallEdges, initToolNodes } from './utils';
import { parseJsonArgs } from '../../../../ai/utils';
import { sliceStrStartEnd } from '@fastgpt/global/common/string/tools';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { toolValueTypeList, valueTypeJsonSchemaMap } from '@fastgpt/global/core/workflow/constants';
import { runAgentCall } from '../../../../ai/llm/agentCall';
import type { ToolCallChildrenInteractive } from '@fastgpt/global/core/workflow/template/system/interactive/type';
import type { JsonSchemaPropertiesItemType } from '@fastgpt/global/core/app/jsonschema';
import {
  SANDBOX_SYSTEM_PROMPT,
  SANDBOX_ICON,
  SANDBOX_TOOL_NAME,
  SANDBOX_GET_FILE_URL_TOOL_NAME,
  SANDBOX_TOOLS
} from '@fastgpt/global/core/ai/sandbox/constants';
import { getSandboxToolWorkflowResponse, getPlanToolWorkflowResponse } from './constants';
import { callSandboxTool } from '../../../../ai/sandbox/toolCall';
import { systemSubInfo } from '@fastgpt/global/core/workflow/node/agent/constants';
import { parseI18nString } from '@fastgpt/global/common/i18n/utils';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import {
  applySetPlan,
  applyPlanUpdate,
  createPlanAgentTools,
  setPlanToolName,
  updatePlanToolName
} from './plan';
import { compactToolCallPlanResponses } from './plan/assistantResponses';

type ResponseType = {
  requestIds: string[];
  error?: string;
  toolDispatchFlowResponses: ChildResponseItemType[];
  toolCallInputTokens: number;
  toolCallOutputTokens: number;
  toolCallTotalPoints: number; // 每次 LLM 调用单独计价后的累计价格（用于梯度计费）
  completeMessages: ChatCompletionMessageParam[];
  assistantResponses: AIChatItemValueItemType[];
  finish_reason: CompletionFinishReason;
  toolWorkflowInteractiveResponse?: ToolCallChildrenInteractive;
};

export const runToolCall = async (props: DispatchToolModuleProps): Promise<ResponseType> => {
  const {
    messages,
    toolNodes,
    toolModel,
    childrenInteractiveParams,

    ...workflowProps
  } = props;
  const {
    checkIsStopping,
    requestOrigin,
    runtimeNodes,
    runtimeEdges,
    stream,
    retainDatasetCite = true,
    externalProvider,
    workflowStreamResponse,
    usagePush,
    params: {
      temperature,
      maxToken,
      aiChatVision,
      aiChatTopP,
      aiChatStopSign,
      aiChatResponseFormat,
      aiChatJsonSchema,
      aiChatReasoning,
      isResponseAnswerText = true,
      useAgentSandbox,
      useAgentPlan
    }
  } = workflowProps;

  // 构建 tools 参数
  const toolNodesMap = new Map<string, ToolNodeItemType>();
  const tools: ChatCompletionTool[] = toolNodes.map((item) => {
    toolNodesMap.set(item.nodeId, item);
    if (item.jsonSchema) {
      return {
        type: 'function',
        function: {
          name: item.nodeId,
          description: `${item.name}: ${item.toolDescription || item.intro}`,
          parameters: item.jsonSchema
        }
      };
    }

    const properties: Record<string, JsonSchemaPropertiesItemType> = {};
    item.toolParams.forEach((item) => {
      const jsonSchema = item.valueType
        ? valueTypeJsonSchemaMap[item.valueType] || toolValueTypeList[0].jsonSchema
        : toolValueTypeList[0].jsonSchema;

      properties[item.key] = {
        ...jsonSchema,
        description: item.toolDescription || '',
        enum: item.enum?.split('\n').filter(Boolean) || undefined
      };
    });

    return {
      type: 'function',
      function: {
        name: item.nodeId,
        description: `${item.name}: ${item.toolDescription || item.intro}`,
        parameters: {
          type: 'object',
          properties,
          required: item.toolParams.filter((item) => item.required).map((item) => item.key)
        }
      }
    };
  });

  // 注入 sandbox_shell 工具和提示词
  let finalMessages = messages;
  if (useAgentSandbox && global.feConfigs?.show_agent_sandbox) {
    // 注入 sandbox_shell 工具
    tools.push(...SANDBOX_TOOLS);

    // 追加提示词
    const systemMessage = messages.find((m) => m.role === 'system');
    if (systemMessage) {
      finalMessages = messages.map((m) =>
        m.role === 'system' ? { ...m, content: `${m.content}\n\n${SANDBOX_SYSTEM_PROMPT}` } : m
      );
    } else {
      finalMessages = [{ role: 'system', content: SANDBOX_SYSTEM_PROMPT }, ...messages];
    }
  }

  // 注入 plan 控制工具（引导词在工具 description 内）
  if (useAgentPlan) {
    tools.push(...createPlanAgentTools());
  }
  const planValueId = getNanoid();
  let activePlan = props.activePlan;
  const isPlanToolName = (name?: string) =>
    !!useAgentPlan && (name === setPlanToolName || name === updatePlanToolName);

  const getToolInfo = (name: string) => {
    const systemTool = systemSubInfo[name];
    if (systemTool) {
      return {
        name: parseI18nString(systemTool.name, workflowProps.lang),
        avatar: systemTool.avatar
      };
    }

    const toolNode = toolNodesMap.get(name);
    return {
      name: toolNode?.name || '',
      avatar: toolNode?.avatar || '',
      rawData: toolNode
    };
  };

  // 工具响应原始值
  const toolRunResponses: ChildResponseItemType[] = [];

  const {
    inputTokens,
    outputTokens,
    llmTotalPoints,
    completeMessages,
    assistantMessages,
    interactiveResponse,
    finish_reason,
    error,
    requestIds
  } = await runAgentCall({
    maxRunAgentTimes: 50,
    body: {
      messages: finalMessages,
      tools,
      model: toolModel.model,
      max_tokens: maxToken,
      stream,
      temperature,
      top_p: aiChatTopP,
      stop: aiChatStopSign,
      response_format: {
        type: aiChatResponseFormat,
        json_schema: aiChatJsonSchema
      },
      requestOrigin,
      retainDatasetCite,
      useVision: aiChatVision
    },
    childrenInteractiveParams,
    controlToolNames: useAgentPlan ? [setPlanToolName, updatePlanToolName] : undefined,
    userKey: externalProvider.openaiAccount,
    isAborted: checkIsStopping,
    usagePush,
    onReasoning({ text }) {
      if (!aiChatReasoning) return;
      workflowStreamResponse?.({
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({
          reasoning_content: text
        })
      });
    },
    onStreaming({ text }) {
      if (!isResponseAnswerText) return;
      workflowStreamResponse?.({
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({
          text
        })
      });
    },
    onToolCall({ call }) {
      if (isPlanToolName(call.function.name)) {
        workflowStreamResponse?.({
          id: planValueId,
          event: SseResponseEventEnum.planStatus,
          data: {
            planStatus: {
              status: call.function.name === setPlanToolName ? 'generating' : 'updating'
            }
          }
        });
        return;
      }
      if (!isResponseAnswerText) return;
      const toolNode = getToolInfo(call.function.name);
      if (toolNode) {
        workflowStreamResponse?.({
          id: call.id,
          event: SseResponseEventEnum.toolCall,
          data: {
            tool: {
              id: call.id,
              toolName: toolNode.name,
              toolAvatar: toolNode.avatar,
              functionName: call.function.name,
              params: call.function.arguments ?? ''
            }
          }
        });
      }
    },
    onToolParam({ tool, params }) {
      if (isPlanToolName(tool.function.name)) return;
      if (!isResponseAnswerText) return;
      workflowStreamResponse?.({
        id: tool.id,
        event: SseResponseEventEnum.toolParams,
        data: {
          tool: {
            id: tool.id,
            toolName: '',
            toolAvatar: '',
            params
          }
        }
      });
    },
    handleToolResponse: async ({ call, messages }) => {
      const tool = getToolInfo(call.function?.name);

      const {
        response,
        flowResponse,
        assistantMessages = [],
        usages = [],
        interactive,
        stop
      } = await (async () => {
        // 拦截 plan 控制工具调用
        if (isPlanToolName(call.function?.name)) {
          const args = parseJsonArgs(call.function.arguments);
          const result =
            call.function.name === setPlanToolName
              ? applySetPlan({ input: args })
              : applyPlanUpdate({ plan: activePlan, update: args });

          if (result.success) {
            activePlan = result.plan;
          }
          toolRunResponses.push(
            getPlanToolWorkflowResponse({
              callId: call.id,
              operation: call.function.name as 'set_plan' | 'update_plan',
              message: result.message
            })
          );
          if (result.success) {
            workflowStreamResponse?.({
              id: planValueId,
              event: SseResponseEventEnum.plan,
              data: { plan: result.plan }
            });
          }
          return { response: result.message };
        }
        // 拦截 sandbox 工具调用
        if (
          call.function?.name === SANDBOX_TOOL_NAME ||
          call.function?.name === SANDBOX_GET_FILE_URL_TOOL_NAME
        ) {
          const { input, response, durationSeconds } = await callSandboxTool({
            toolName: call.function.name,
            rawArgs: call.function.arguments ?? '',
            appId: String(workflowProps.runningAppInfo.id),
            userId: String(workflowProps.uid),
            chatId: workflowProps.chatId
          });

          const flowResponse = getSandboxToolWorkflowResponse({
            name: tool.name,
            logo: SANDBOX_ICON,
            toolId: call.function.name,
            input,
            response,
            durationSeconds
          });

          return { response, flowResponse };
        } else {
          const toolNode = tool?.rawData;

          if (!toolNode) {
            return {
              response: 'Call tool not found'
            };
          }

          // Init tool params and run
          const startParams = parseJsonArgs(call.function.arguments);
          initToolNodes(runtimeNodes, [toolNode.nodeId], startParams);
          initToolCallEdges(runtimeEdges, [toolNode.nodeId]);

          const toolRunResponse = await runWorkflow({
            ...workflowProps,
            runtimeNodes,
            isToolCall: true
          });

          // Format tool response
          const stringToolResponse = formatToolResponse(toolRunResponse.toolResponses);

          return {
            response: stringToolResponse,
            flowResponse: toolRunResponse,
            assistantMessages: chats2GPTMessages({
              messages: [
                {
                  obj: ChatRoleEnum.AI,
                  value: toolRunResponse.assistantResponses
                }
              ],
              reserveId: false
            }),
            usages: toolRunResponse.flowUsages,
            interactive: toolRunResponse.workflowInteractiveResponse,
            stop: toolRunResponse.flowResponses?.some((item) => item.toolStop)
          };
        }
      })();

      if (isResponseAnswerText && !isPlanToolName(call.function?.name)) {
        workflowStreamResponse?.({
          id: call.id,
          event: SseResponseEventEnum.toolResponse,
          data: {
            tool: {
              id: call.id,
              toolName: '',
              toolAvatar: '',
              params: '',
              response: sliceStrStartEnd(response, 50000, 50000)
            }
          }
        });
      }

      if (flowResponse) {
        toolRunResponses.push(flowResponse);
      }

      return {
        response,
        assistantMessages,
        usages,
        interactive,
        stop
      };
    },
    handleInteractiveTool: async ({ childrenResponse, toolParams }) => {
      initToolNodes(runtimeNodes, childrenResponse.entryNodeIds);
      initToolCallEdges(runtimeEdges, childrenResponse.entryNodeIds);

      const toolRunResponse = await runWorkflow({
        ...workflowProps,
        lastInteractive: childrenResponse,
        runtimeNodes,
        runtimeEdges,
        isToolCall: true
      });
      // console.dir(runtimeEdges, { depth: null });
      const stringToolResponse = formatToolResponse(toolRunResponse.toolResponses);

      if (isResponseAnswerText) {
        workflowStreamResponse?.({
          id: toolParams.toolCallId,
          event: SseResponseEventEnum.toolResponse,
          data: {
            tool: {
              id: toolParams.toolCallId,
              toolName: '',
              toolAvatar: '',
              params: '',
              response: sliceStrStartEnd(stringToolResponse, 50000, 50000)
            }
          }
        });
      }

      toolRunResponses.push(toolRunResponse);
      const assistantMessages = chats2GPTMessages({
        messages: [
          {
            obj: ChatRoleEnum.AI,
            value: toolRunResponse.assistantResponses
          }
        ],
        reserveId: false
      });

      return {
        response: stringToolResponse,
        assistantMessages,
        usages: toolRunResponse.flowUsages,
        interactive: toolRunResponse.workflowInteractiveResponse,
        stop: toolRunResponse.flowResponses?.some((item) => item.toolStop)
      };
    }
  });

  const assistantResponses = GPTMessages2Chats({
    messages: assistantMessages,
    reserveTool: true,
    reserveReason: aiChatReasoning,
    getToolInfo
  })
    .map((item) => item.value as AIChatItemValueItemType[])
    .flat();

  const finalAssistantResponses = useAgentPlan
    ? compactToolCallPlanResponses({ assistantResponses, finalPlan: activePlan })
    : assistantResponses;

  return {
    requestIds,
    error,
    toolDispatchFlowResponses: toolRunResponses,
    toolCallInputTokens: inputTokens,
    toolCallOutputTokens: outputTokens,
    toolCallTotalPoints: llmTotalPoints,
    completeMessages,
    assistantResponses: finalAssistantResponses,
    finish_reason,
    toolWorkflowInteractiveResponse: interactiveResponse
  };
};
