import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  CompletionFinishReason
} from '@fastgpt/global/core/ai/llm/type';
import {
  SseResponseEventEnum,
  DispatchNodeResponseKeyEnum
} from '@fastgpt/global/core/workflow/runtime/constants';
import {
  textAdaptGptResponse,
  replaceEditorVariable
} from '@fastgpt/global/core/workflow/runtime/utils';
import { runWorkflow } from '../../index';
import type { ChildResponseItemType, DispatchToolModuleProps, ToolNodeItemType } from './type';
import {
  chats2GPTMessages,
  GPTMessages2Chats,
  chatValue2RuntimePrompt
} from '@fastgpt/global/core/chat/adapt';
import type { AIChatItemValueItemType } from '@fastgpt/global/core/chat/type';
import { formatToolResponse, initToolCallEdges, initToolNodes } from './utils';
import { parseJsonArgs } from '../../../../ai/utils';
import { sliceStrStartEnd } from '@fastgpt/global/common/string/tools';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import {
  toolValueTypeList,
  valueTypeJsonSchemaMap,
  WorkflowIOValueTypeEnum,
  NodeInputKeyEnum
} from '@fastgpt/global/core/workflow/constants';
import { FlowNodeInputTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import type { WorkflowInteractiveResponseType } from '@fastgpt/global/core/workflow/template/system/interactive/type';
import {
  CONFIRM_TOOL,
  CONFIRM_TOOL_NAME,
  ConfirmToolSchema,
  normalizeConfirm
} from '@fastgpt/global/core/workflow/node/agent/confirmTools';
import {
  READ_SKILL_NAME,
  ReadSkillToolSchema,
  buildReadSkillTool
} from '@fastgpt/global/core/workflow/node/agent/readSkillTools';
import { dispatchSkill } from '../../tools/skill';
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
import {
  getSandboxToolWorkflowResponse,
  getPlanToolWorkflowResponse,
  getConfirmToolWorkflowResponse,
  getReadSkillToolWorkflowResponse
} from './constants';
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
import { readDirectOutput, restoreToolStartParams } from './subAgentUtils';

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
  terminalResponse?: string;
};

export const runToolCall = async (props: DispatchToolModuleProps): Promise<ResponseType> => {
  const {
    messages,
    toolNodes,
    toolModel,
    childrenInteractiveParams,
    childToolPool,
    skillNodes,

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
      useAgentPlan,
      useUserConfirm
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
  // 注入内置人工确认工具（默认开，存量节点无该 key 时视为开）
  if (useUserConfirm !== false) {
    tools.push(CONFIRM_TOOL);
  }
  // 注入技能目录读取工具（目录在工具 metadata 内，不注入系统提示词）
  if (skillNodes?.length) {
    tools.push(buildReadSkillTool(skillNodes));
  }
  const planValueId = getNanoid();
  let activePlan = props.activePlan;
  let pendingInteractive = false;
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
    requestIds,
    terminalResponse
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
        stop,
        terminalResponse
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
        }
        // 拦截内置技能目录读取工具：按名取正文，纯读不跑画布
        if (call.function?.name === READ_SKILL_NAME && skillNodes?.length) {
          const catalog = skillNodes.map((s) => s.name).join('、');
          const parsed = ReadSkillToolSchema.safeParse(
            parseJsonArgs(call.function.arguments) ?? {}
          );
          if (!parsed.success) {
            return {
              response: `read_skill 参数无效：需提供 skill。可用技能：${catalog}`
            };
          }
          const { skill, focus } = parsed.data;
          const matched =
            skillNodes.find((s) => s.nodeId === skill) ??
            skillNodes.find((s) => s.name.trim() === skill.trim());
          if (!matched) {
            return { response: `未找到技能「${skill}」。可用技能：${catalog}` };
          }
          const rtNode = runtimeNodes.find((n) => n.nodeId === matched.nodeId);
          const raw =
            rtNode?.inputs.find((i) => i.key === NodeInputKeyEnum.textareaInput)?.value ?? '';
          const text = replaceEditorVariable({
            text: raw,
            nodesMap: workflowProps.runtimeNodesMap ?? {},
            variables: workflowProps.variableState.toRuntimeRecord()
          });
          const result = dispatchSkill({
            node: rtNode ?? matched,
            variableState: workflowProps.variableState,
            params: { [NodeInputKeyEnum.textareaInput]: text }
          });
          let response = String(result[DispatchNodeResponseKeyEnum.toolResponses] ?? '');
          if (focus?.trim()) {
            response += `\n\n【调用方关注】\n${focus.trim()}`;
          }
          return {
            response,
            usages: [],
            flowResponse: getReadSkillToolWorkflowResponse({
              name: matched.name,
              toolId: READ_SKILL_NAME,
              input: { skill, focus },
              response
            })
          };
        }
        // 拦截内置人工确认工具：合成 userInput 交互挂起循环
        if (call.function?.name === CONFIRM_TOOL_NAME) {
          if (pendingInteractive) {
            return {
              response: '本轮已有待处理交互，请等待用户完成后再发起确认。'
            };
          }
          const parsed = ConfirmToolSchema.safeParse(parseJsonArgs(call.function.arguments));
          if (!parsed.success) {
            return {
              response: `确认工具参数无效：${parsed.error.message}。请提供 questions（1-5 问，每问含 question 与可选 options）。`
            };
          }
          const questions = normalizeConfirm(parsed.data.questions);
          if (!questions.length) {
            return { response: '确认工具参数无效：questions 不能为空。' };
          }
          const interactive: WorkflowInteractiveResponseType = {
            type: 'userInput',
            params: {
              description: questions.map((q) => q.question).join('\n'),
              confirmCard: true,
              inputForm: questions.map((q, i) => ({
                key: `q${i}`,
                label: q.question,
                type: q.options.length
                  ? q.multiple
                    ? FlowNodeInputTypeEnum.checkbox
                    : FlowNodeInputTypeEnum.radio
                  : FlowNodeInputTypeEnum.input,
                list: q.options.map((o) => ({
                  label: o.label,
                  value: o.label,
                  ...(o.description ? { description: o.description } : {})
                })),
                value: q.multiple ? [] : '',
                valueType: q.multiple
                  ? WorkflowIOValueTypeEnum.arrayString
                  : WorkflowIOValueTypeEnum.string,
                required: true,
                allowCustom: true
              }))
            },
            entryNodeIds: [CONFIRM_TOOL_NAME],
            memoryEdges: [],
            nodeOutputs: [],
            usageId: workflowProps.usageId
          };
          return {
            response: `等待用户确认：${questions.map((q) => q.question).join('；')}`,
            interactive,
            flowResponse: getConfirmToolWorkflowResponse({
              name: tool.name,
              toolId: CONFIRM_TOOL_NAME,
              input: { questions },
              response: '等待用户确认'
            }),
            usages: []
          };
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

          // 直出命中：子运行静默，避免子流式与父级 terminalResponse 补推重复输出
          const directOutput = readDirectOutput(
            runtimeNodes.find((n) => n.nodeId === toolNode.nodeId),
            startParams
          );
          const toolRunResponse = await runWorkflow({
            ...workflowProps,
            ...(directOutput ? { stream: false, workflowStreamResponse: undefined } : {}),
            runtimeNodes,
            parentToolNodes: childToolPool ?? toolNodes,
            parentToolModel: toolModel.model,
            isToolCall: true
          });

          // Format tool response
          const stringToolResponse = formatToolResponse(toolRunResponse.toolResponses);

          // 直接输出钩子：调用时读取覆写后的参数，成品答复终止循环并原样提升
          const isTerminal = directOutput && !toolRunResponse.workflowInteractiveResponse;

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
            stop: toolRunResponse.flowResponses?.some((item) => item.toolStop) || isTerminal,
            terminalResponse: isTerminal ? stringToolResponse : undefined
          };
        }
      })();

      if (interactive) {
        pendingInteractive = true;
      }
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
        stop,
        terminalResponse
      };
    },
    handleInteractiveTool: async ({ childrenResponse, toolParams }) => {
      // 内置人工确认工具 resume：无画布节点，直接解析用户答案回流
      const confirmCall = toolParams.memoryRequestMessages
        .filter((m) => m.role === 'assistant' && m.tool_calls)
        .flatMap((m) => (m.role === 'assistant' ? m.tool_calls : undefined) ?? [])
        .find((tc) => tc.id === toolParams.toolCallId);
      if (confirmCall?.function.name === CONFIRM_TOOL_NAME) {
        const { text } = chatValue2RuntimePrompt(workflowProps.query);
        const answers = (() => {
          try {
            return JSON.parse(text);
          } catch {
            return {};
          }
        })();
        const hasAnswer = Object.values(answers ?? {}).some((v) =>
          Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
        );
        if ((answers as { skip?: boolean })?.skip === true) {
          return {
            response: '用户跳过本次确认，请按默认策略继续执行。',
            assistantMessages: [],
            usages: []
          };
        }
        if (!hasAnswer) {
          return {
            response: '用户未提供有效答案，请重新询问或按默认策略继续。',
            assistantMessages: [],
            usages: []
          };
        }
        const response = formatToolResponse(answers);
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
                response
              }
            }
          });
        }
        return { response, assistantMessages: [], usages: [] };
      }
      // 还原上一轮 LLM 注入的参数（systemPrompt/任务/白名单/输出钩子），避免 resume 丢参
      const startParams = restoreToolStartParams(
        toolParams.memoryRequestMessages,
        toolParams.toolCallId,
        childrenResponse.entryNodeIds
      );
      initToolNodes(runtimeNodes, childrenResponse.entryNodeIds, startParams);
      initToolCallEdges(runtimeEdges, childrenResponse.entryNodeIds);

      // 直出命中：resume 子运行同样静默，保证唯一输出
      const directOutput = childrenResponse.entryNodeIds.some((id: string) =>
        readDirectOutput(
          runtimeNodes.find((n) => n.nodeId === id),
          startParams
        )
      );
      const toolRunResponse = await runWorkflow({
        ...workflowProps,
        ...(directOutput ? { stream: false, workflowStreamResponse: undefined } : {}),
        lastInteractive: childrenResponse,
        runtimeNodes,
        runtimeEdges,
        parentToolNodes: childToolPool ?? toolNodes,
        parentToolModel: toolModel.model,
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

      const isTerminal = directOutput && !toolRunResponse.workflowInteractiveResponse;

      return {
        response: stringToolResponse,
        assistantMessages,
        usages: toolRunResponse.flowUsages,
        interactive: toolRunResponse.workflowInteractiveResponse,
        stop: toolRunResponse.flowResponses?.some((item) => item.toolStop) || isTerminal,
        terminalResponse: isTerminal ? stringToolResponse : undefined
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
    toolWorkflowInteractiveResponse: interactiveResponse,
    terminalResponse
  };
};
