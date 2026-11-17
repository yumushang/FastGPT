import { NextAPI } from '@/service/middleware/entry';
import { i18nT } from '@fastgpt/global/common/i18n/utils';
import {
  GenerateMcpModelNamesBodySchema,
  GenerateMcpModelNamesResponseSchema,
  type GenerateMcpModelNamesBodyType,
  type GenerateMcpModelNamesResponseType
} from '@fastgpt/global/openapi/core/app/mcpTools/api';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';
import type { ApiRequestProps } from '@fastgpt/next/type';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { generateMcpModelNames } from '@fastgpt/service/core/ai/functions/generateMcpModelNames';
import { getTeamModelHandle } from '@fastgpt/service/core/ai/model/catalog/service';
import { authCert } from '@fastgpt/service/support/permission/auth/common';
import { getAuthorizedModelIds } from '@fastgpt/service/support/permission/model/auth';
import { createUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { formatModelChars2Points } from '@fastgpt/service/support/wallet/usage/utils';

async function handler(
  req: ApiRequestProps<GenerateMcpModelNamesBodyType>
): Promise<GenerateMcpModelNamesResponseType> {
  const { tools, existingNames } = parseApiInput({
    req,
    bodySchema: GenerateMcpModelNamesBodySchema
  }).body;

  const { teamId, tmbId, isRoot } = await authCert({ req, authToken: true });
  const modelHandle = await getTeamModelHandle({ teamId });
  const authorizedIds = await getAuthorizedModelIds({
    actor: { teamId, tmbId, isRoot: Boolean(isRoot) },
    handle: modelHandle
  });
  const model = modelHandle.getDefaultModelData('llm', { authorizedIds });

  const { modelNames, inputTokens, outputTokens } = await generateMcpModelNames({
    tools,
    existingNames,
    model,
    teamId
  });

  const { totalPoints } = formatModelChars2Points({ model, inputTokens, outputTokens });
  createUsage({
    teamId,
    tmbId,
    appName: i18nT('account_usage:mcp'),
    totalPoints,
    source: UsageSourceEnum.mcp,
    list: [
      {
        moduleName: i18nT('account_usage:mcp'),
        amount: totalPoints,
        modelId: model.modelId,
        inputTokens,
        outputTokens
      }
    ]
  });

  return GenerateMcpModelNamesResponseSchema.parse({ modelNames });
}

export default NextAPI(handler);
