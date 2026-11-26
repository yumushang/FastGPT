import { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import {
  DispatchNodeResponseKeyEnum,
  SseResponseEventEnum
} from '@fastgpt/global/core/workflow/runtime/constants';
import { textAdaptGptResponse } from '@fastgpt/global/core/workflow/runtime/utils';
import type {
  ChatDispatchProps,
  DispatchNodeResultType,
  RuntimeNodeItemType
} from '@fastgpt/global/core/workflow/runtime/type';
import { getLLMModel } from '../../../../ai/model';
import { filterToolNodeIdByEdges, getNodeErrResponse, getHistories } from '../../utils';
import { runToolCall } from './toolCall';
import { type DispatchToolModuleProps, type ToolNodeItemType } from './type';
import type {
  UserChatItemFileItemType,
  ChatItemMiniType,
  UserChatItemValueItemType
} from '@fastgpt/global/core/chat/type';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import {
  GPTMessages2Chats,
  chatValue2RuntimePrompt,
  chats2GPTMessages,
  getSystemPrompt_ChatItemType,
  runtimePrompt2ChatsValue
} from '@fastgpt/global/core/chat/adapt';
import { getHistoryPreview } from '@fastgpt/global/core/chat/utils';
import { replaceVariable } from '@fastgpt/global/common/string/tools';
import { getMultiplePrompt } from './constants';
import { filterToolResponseToPreview } from './utils';
import { getFileContentFromLinks, getHistoryFileLinks } from '../../tools/readFiles';
import { parseUrlToFileType } from '../../../utils/context';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { getDocumentQuotePrompt } from '@fastgpt/global/core/ai/prompt/AIChat';
import { postTextCensor } from '../../../../chat/postTextCensor';
import type { FlowNodeInputItemType } from '@fastgpt/global/core/workflow/type/io';
import type { McpToolDataType } from '@fastgpt/global/core/app/tool/mcpTool/type';
import type { JSONSchemaInputType } from '@fastgpt/global/core/app/jsonschema';
import { getToolConfigStatus } from '@fastgpt/global/core/app/formEdit/utils';
import { readToolCallActivePlan } from './plan/activePlan';
import { matchPoolByWhitelist, mergeToolNodes, splitPoolForLLM } from './subAgentUtils';

type Response = DispatchNodeResultType<{
  [NodeOutputKeyEnum.answerText]: string;
}>;

export const dispatchRunTools = async (props: DispatchToolModuleProps): Promise<Response> => {
  let {
    node: { nodeId, name, isEntry, version, inputs },
    runtimeNodes,
    runtimeEdges,
    histories,
    query,
    requestOrigin,
    chatConfig,
    lastInteractive,
    runningUserInfo,
    externalProvider,
    usageId,
    params: {
      model,
      systemPrompt,
      userChatInput,
      history = 6,
      fileUrlList: fileLinks,
      aiChatVision,
      aiChatReasoning,
      isResponseAnswerText = true,
      useAgentPlan,
      toolPoolMode,
      toolWhitelist,
      inheritCallerModel,
      useUserConfirm,
      useReadSkill
    }
  } = props;

  try {
    const isSubAgent = props.node.flowNodeType === FlowNodeTypeEnum.subAgent;
    const toolModel = getLLMModel(
      isSubAgent && inheritCallerModel !== false ? props.parentToolModel || model : model
    );
    const useVision = aiChatVision && toolModel.vision;
    const chatHistories = getHistories(history, histories);

    props.params.aiChatVision = aiChatVision && toolModel.vision;
    props.params.aiChatReasoning = aiChatReasoning && toolModel.reasoning;
    const fileUrlInput = inputs.find((item) => item.key === NodeInputKeyEnum.fileUrlList);
    if (!fileUrlInput || !fileUrlInput.value || fileUrlInput.value.length === 0) {
      fileLinks = undefined;
    }

    const getEdgeToolNodes = (): ToolNodeItemType[] => {
      const toolNodeIds = filterToolNodeIdByEdges({ nodeId, edges: runtimeEdges });

      // Gets the module to which the tool is connected
      return toolNodeIds
        .map((nodeId) => {
          const tool = runtimeNodes.find((item) => item.nodeId === nodeId);
          return tool;
        })
        .filter((tool) => {
          if (!tool) return false;
          // Check is valid and filter
          const configStatus = getToolConfigStatus({
            tool
          });
          if (configStatus.status === 'invalid' || configStatus.status === 'waitingForConfig') {
            return false;
          }
          return true;
        })
        .map<ToolNodeItemType>((_) => {
          const tool = _!;
          const toolParams: FlowNodeInputItemType[] = [];
          tool?.inputs.forEach((input) => {
            if (input.toolDescription) {
              toolParams.push(input);
            }
            if (
              (input.key === NodeInputKeyEnum.toolData || input.key === 'toolData') &&
              input.value?.inputSchema
            ) {
              const value = input.value as McpToolDataType;
              tool.jsonSchema = value.inputSchema;
            }
          });

          return {
            nodeId: tool.nodeId,
            name: tool.name,
            flowNodeType: tool.flowNodeType,
            avatar: tool.avatar,
            intro: tool.intro,
            toolDescription: tool.toolDescription,
            jsonSchema: tool.jsonSchema,
            toolParams,
            visibleToMain:
              tool.inputs.find((i) => i.key === NodeInputKeyEnum.visibleToMain)?.value === true
          };
        });
    };

    // 子代理：自身边工具（域内基线）+ 主节点工具池白名单追加
    let fullToolNodes: ToolNodeItemType[];
    let whitelistNote = '';
    if (isSubAgent) {
      const ownEdgeTools = getEdgeToolNodes();
      const pool = props.parentToolNodes ?? [];
      const { selected, misses } = matchPoolByWhitelist(pool, toolWhitelist);
      fullToolNodes = mergeToolNodes(ownEdgeTools, selected);
      if (fullToolNodes.length === 0 && useUserConfirm === false) {
        return getNodeErrResponse({
          error: `子代理没有可用工具：自身未挂载工具，且白名单未匹配到工具池中的工具。当前工具池可用工具：${
            pool.map((t) => `${t.name}(${t.nodeId})`).join('、') || '（空）'
          }。请调整白名单后重试。`
        });
      }
      if (misses.length > 0) {
        whitelistNote = `注意：工具白名单中的 ${misses.join('、')} 不在工具池中，已忽略。`;
      }
    } else {
      fullToolNodes = getEdgeToolNodes();
    }
    // 目录读取模式：技能节点剔出 LLM 工具列表与系统目录，改经 read_skill 深读
    const skillNodes =
      useReadSkill !== false
        ? fullToolNodes.filter((t) => t.flowNodeType === FlowNodeTypeEnum.skill)
        : [];
    const skillIds = new Set(skillNodes.map((t) => t.nodeId));
    const dispatchable = skillIds.size
      ? fullToolNodes.filter((t) => !skillIds.has(t.nodeId))
      : fullToolNodes;
    const { llmToolNodes, catalog } = isSubAgent
      ? { llmToolNodes: dispatchable, catalog: '' }
      : splitPoolForLLM(dispatchable, !!toolPoolMode);

    // Check interactive entry
    props.node.isEntry = false;
    const hasReadFilesTool = fullToolNodes.some(
      (item) => item.flowNodeType === FlowNodeTypeEnum.readFiles
    );

    const globalFiles = chatValue2RuntimePrompt(query).files;
    const { documentQuoteText, userFiles } = await getMultiInput({
      runningUserInfo,
      histories: chatHistories,
      requestOrigin,
      maxFiles: chatConfig?.fileSelectConfig?.maxFiles || 20,
      customPdfParse: chatConfig?.fileSelectConfig?.customPdfParse,
      fileLinks,
      inputFiles: globalFiles,
      hasReadFilesTool,
      usageId,
      appId: props.runningAppInfo.id,
      chatId: props.chatId,
      uId: props.uid
    });

    const concatenateSystemPrompt = [
      toolModel.defaultSystemChatPrompt,
      systemPrompt,
      catalog,
      whitelistNote,
      documentQuoteText
        ? replaceVariable(getDocumentQuotePrompt(version), {
            quote: documentQuoteText
          })
        : ''
    ]
      .filter(Boolean)
      .join('\n\n===---===---===\n\n');

    const messages: ChatItemMiniType[] = (() => {
      const value: ChatItemMiniType[] = [
        ...getSystemPrompt_ChatItemType(concatenateSystemPrompt),
        // Add file input prompt to histories
        ...chatHistories.map((item) => {
          if (item.obj === ChatRoleEnum.Human) {
            return {
              ...item,
              value: toolCallMessagesAdapt({
                userInput: item.value,
                skip: !hasReadFilesTool
              })
            };
          }
          return item;
        }),
        {
          obj: ChatRoleEnum.Human,
          value: toolCallMessagesAdapt({
            skip: !hasReadFilesTool,
            userInput: runtimePrompt2ChatsValue({
              text: userChatInput,
              files: userFiles
            })
          })
        }
      ];
      if (lastInteractive && isEntry) {
        return value.slice(0, -2);
      }
      return value;
    })();

    // censor model and system key
    if (toolModel.censor && !externalProvider.openaiAccount?.key) {
      await postTextCensor({
        text: `${systemPrompt}
          ${userChatInput}
        `
      });
    }

    const {
      toolWorkflowInteractiveResponse,
      toolDispatchFlowResponses, // tool flow response
      toolCallInputTokens,
      toolCallOutputTokens,
      toolCallTotalPoints,
      completeMessages = [], // The actual message sent to AI(just save text)
      assistantResponses = [], // FastGPT system store assistant.value response
      finish_reason,
      error,
      requestIds,
      terminalResponse
    } = await (async () => {
      const adaptMessages = chats2GPTMessages({
        messages,
        reserveId: false,
        reserveTool: true
      });

      return runToolCall({
        ...props,
        runtimeNodes,
        runtimeEdges,
        toolNodes: llmToolNodes,
        childToolPool: fullToolNodes,
        skillNodes,
        toolModel,
        messages: adaptMessages,
        activePlan: useAgentPlan ? readToolCallActivePlan({ histories }) : undefined,
        childrenInteractiveParams:
          lastInteractive?.type === 'toolChildrenInteractive' ? lastInteractive.params : undefined
      });
    })();

    // Usage computed
    // modelName 直接从 toolModel 获取；totalPoints 使用预计算值，保证梯度计费正确
    const modelName = toolModel.name;
    const modelTotalPoints = toolCallTotalPoints;
    const toolTotalPoints = toolDispatchFlowResponses
      .map((item) => item.flowUsages)
      .flat()
      .reduce((sum, item) => sum + item.totalPoints, 0);
    // concat tool usage
    const totalPointsUsage = modelTotalPoints + toolTotalPoints;

    // Preview assistant responses
    const previewAssistantResponses = filterToolResponseToPreview(assistantResponses);

    // 直接输出钩子：终端工具答复原样提升为最终回复，不再经过模型总结
    const answerText =
      terminalResponse ??
      previewAssistantResponses
        .filter((item) => item.text?.content)
        .map((item) => item.text?.content || '')
        .join('');
    if (terminalResponse) {
      props.workflowStreamResponse?.({
        event: SseResponseEventEnum.fastAnswer,
        data: textAdaptGptResponse({
          text: terminalResponse
        })
      });
    }

    if (error) {
      return getNodeErrResponse({
        error,
        [DispatchNodeResponseKeyEnum.nodeResponse]: {
          totalPoints: totalPointsUsage,
          toolCallInputTokens: toolCallInputTokens,
          toolCallOutputTokens: toolCallOutputTokens,
          childTotalPoints: toolTotalPoints,
          model: modelName,
          query: userChatInput,
          historyPreview: getHistoryPreview(
            GPTMessages2Chats({ messages: completeMessages, reserveTool: false }),
            10000,
            useVision
          ),
          toolDetail: toolDispatchFlowResponses.map((item) => item.flowResponses).flat(),
          mergeSignId: nodeId,
          finishReason: finish_reason,
          llmRequestIds: requestIds
        },
        [DispatchNodeResponseKeyEnum.runTimes]: toolDispatchFlowResponses.reduce(
          (sum, item) => sum + item.runTimes,
          0
        )
      });
    }

    return {
      data: {
        [NodeOutputKeyEnum.answerText]: answerText
      },
      [DispatchNodeResponseKeyEnum.runTimes]: toolDispatchFlowResponses.reduce(
        (sum, item) => sum + item.runTimes,
        0
      ),
      [DispatchNodeResponseKeyEnum.assistantResponses]: terminalResponse
        ? [{ text: { content: terminalResponse } }]
        : isResponseAnswerText
          ? previewAssistantResponses
          : useAgentPlan
            ? previewAssistantResponses.filter((item) => item.plan)
            : undefined,
      [DispatchNodeResponseKeyEnum.toolResponses]: answerText,
      [DispatchNodeResponseKeyEnum.nodeResponse]: {
        // 展示的积分消耗
        totalPoints: totalPointsUsage,
        toolCallInputTokens: toolCallInputTokens,
        toolCallOutputTokens: toolCallOutputTokens,
        childTotalPoints: toolTotalPoints,
        model: modelName,
        query: userChatInput,
        historyPreview: getHistoryPreview(
          GPTMessages2Chats({ messages: completeMessages, reserveTool: false }),
          10000,
          useVision
        ),
        toolDetail: toolDispatchFlowResponses.map((item) => item.flowResponses).flat(),
        mergeSignId: nodeId,
        finishReason: finish_reason,
        llmRequestIds: requestIds
      },
      [DispatchNodeResponseKeyEnum.interactive]: toolWorkflowInteractiveResponse
    };
  } catch (error) {
    return getNodeErrResponse({ error });
  }
};

const getMultiInput = async ({
  runningUserInfo,
  histories,
  fileLinks,
  requestOrigin,
  maxFiles,
  customPdfParse,
  inputFiles,
  hasReadFilesTool,
  usageId,
  appId,
  chatId,
  uId
}: {
  runningUserInfo: ChatDispatchProps['runningUserInfo'];
  histories: ChatItemMiniType[];
  fileLinks?: string[];
  requestOrigin?: string;
  maxFiles: number;
  customPdfParse?: boolean;
  inputFiles: UserChatItemFileItemType[];
  hasReadFilesTool: boolean;
  usageId?: string;
  appId: string;
  chatId?: string;
  uId: string;
}) => {
  // Not file quote
  if (!fileLinks || hasReadFilesTool) {
    return {
      documentQuoteText: '',
      userFiles: inputFiles
    };
  }

  const filesFromHistories = getHistoryFileLinks(histories);
  const urls = [...fileLinks, ...filesFromHistories];

  if (urls.length === 0) {
    return {
      documentQuoteText: '',
      userFiles: []
    };
  }

  // Get files from histories
  const { text } = await getFileContentFromLinks({
    // Concat fileUrlList and filesFromHistories; remove not supported files
    urls,
    requestOrigin,
    maxFiles,
    customPdfParse,
    usageId,
    teamId: runningUserInfo.teamId,
    tmbId: runningUserInfo.tmbId
  });

  return {
    documentQuoteText: text,
    userFiles: fileLinks
      .map((url) => parseUrlToFileType(url))
      .filter(Boolean) as UserChatItemFileItemType[]
  };
};

/*
Tool call， auth add file prompt to question。
Guide the LLM to call tool.
*/
const toolCallMessagesAdapt = ({
  userInput,
  skip
}: {
  userInput: UserChatItemValueItemType[];
  skip?: boolean;
}): UserChatItemValueItemType[] => {
  if (skip) return userInput;

  const files = userInput.filter((item) => 'file' in item);

  if (files.length > 0) {
    const filesCount = files.filter((file) => file.file?.type === 'file').length;
    const imgCount = files.filter((file) => file.file?.type === 'image').length;

    if (userInput.some((item) => 'text' in item)) {
      return userInput.map((item) => {
        if ('text' in item) {
          const text = item.text?.content || '';

          return {
            ...item,
            text: {
              content: getMultiplePrompt({ fileCount: filesCount, imgCount, question: text })
            }
          };
        }
        return item;
      });
    }

    // Every input is a file
    return [
      {
        text: {
          content: getMultiplePrompt({ fileCount: filesCount, imgCount, question: '' })
        }
      }
    ];
  }

  return userInput;
};
