import { getNanoid } from '../../../../common/string/tools';
import type { PathDataType, HttpToolConfigType } from './type';
import { type RuntimeNodeItemType } from '../../../workflow/runtime/type';
import { FlowNodeOutputTypeEnum, FlowNodeTypeEnum } from '../../../workflow/node/constant';
import { AppToolSourceEnum } from '../constants';
import { jsonSchema2NodeInput, jsonSchema2NodeOutput } from '../../jsonschema';
import { type StoreSecretValueType } from '../../../../common/secret/type';
import { type JsonSchemaPropertiesItemType } from '../../jsonschema';
import { NodeOutputKeyEnum, WorkflowIOValueTypeEnum } from '../../../workflow/constants';
import { i18nT } from '../../../../../web/i18n/utils';
import type { NodeToolConfigType } from '../../../workflow/type/node';

export const getHTTPToolSetRuntimeNode = ({
  name,
  avatar,
  baseUrl,
  customHeaders,
  apiSchemaStr,
  toolList = [],
  headerSecret
}: {
  name?: string;
  avatar?: string;
  baseUrl?: string;
  customHeaders?: string;
  apiSchemaStr?: string;
  toolList?: HttpToolConfigType[];
  headerSecret?: StoreSecretValueType;
}): RuntimeNodeItemType => {
  return {
    nodeId: getNanoid(16),
    flowNodeType: FlowNodeTypeEnum.toolSet,
    avatar,
    intro: 'HTTP Tools',
    toolConfig: {
      httpToolSet: {
        toolList,
        ...(baseUrl !== undefined && { baseUrl }),
        ...(apiSchemaStr !== undefined && { apiSchemaStr }),
        ...(customHeaders !== undefined && { customHeaders }),
        ...(headerSecret !== undefined && { headerSecret })
      }
    },
    inputs: [],
    outputs: [],
    name: name || '',
    version: ''
  };
};

export const getHTTPToolRuntimeNode = ({
  tool,
  nodeId,
  avatar = 'core/app/type/httpToolsFill',
  toolSetId,
  toolsetName
}: {
  tool: Omit<HttpToolConfigType, 'path' | 'method'>;
  nodeId: string;
  avatar?: string;
  toolSetId: string;
  toolsetName: string;
}): RuntimeNodeItemType => {
  return {
    nodeId,
    flowNodeType: FlowNodeTypeEnum.tool,
    avatar,
    intro: tool.description,
    toolConfig: {
      httpTool: {
        toolId: `${AppToolSourceEnum.http}-${toolSetId}/${tool.name}`
      }
    },
    jsonSchema: tool.requestSchema,
    inputs: jsonSchema2NodeInput({ jsonSchema: tool.inputSchema, schemaType: 'http' }),
    outputs: [
      ...jsonSchema2NodeOutput(tool.outputSchema),
      {
        id: NodeOutputKeyEnum.rawResponse,
        key: NodeOutputKeyEnum.rawResponse,
        required: true,
        label: i18nT('workflow:raw_response'),
        description: i18nT('workflow:tool_raw_response_description'),
        valueType: WorkflowIOValueTypeEnum.any,
        type: FlowNodeOutputTypeEnum.static
      }
    ],
    name: `${toolsetName}/${tool.name}`,
    version: ''
  };
};

export const parseHttpToolConfig = (
  config: NonNullable<NodeToolConfigType['httpTool']>
):
  | {
      toolsetId: string;
      toolName: string;
    }
  | undefined => {
  const prefix = `${AppToolSourceEnum.http}-`;
  if (!config.toolId.startsWith(prefix)) return undefined;
  const [toolsetId, ...rest] = config.toolId.slice(prefix.length).split('/');
  const toolName = rest.join('/');
  if (!toolsetId || !toolName) return undefined;
  return {
    toolsetId,
    toolName
  };
};

export const pathData2ToolList = async (
  pathData: PathDataType[]
): Promise<HttpToolConfigType[]> => {
  try {
    return pathData.map((pathItem) => {
      const inputProperties: Record<string, JsonSchemaPropertiesItemType> = {};
      const inputRequired: string[] = [];
      const outputProperties: Record<string, JsonSchemaPropertiesItemType> = {};
      const outputRequired: string[] = [];
      const { path, staticParams } = splitPathAndStaticParams(pathItem.path);
      let requestSchema = undefined;

      if (pathItem.params && Array.isArray(pathItem.params)) {
        pathItem.params.forEach((param) => {
          if (param.name && param.schema) {
            const staticQueryValue = getOpenApiStaticQueryValue(param);
            if (staticQueryValue !== undefined) {
              addStaticParam(staticParams, param.name, staticQueryValue);
              return;
            }

            if (hasStaticParam(staticParams, param.name)) {
              return;
            }

            requestSchema = param.schema;
            inputProperties[param.name] = {
              type: param.schema.type || 'any',
              description: param.description || '',
              'x-tool-description': param.description || param.name
            };

            if (param.required) {
              inputRequired.push(param.name);
            }
          }
        });
      }
      if (pathItem.request?.content?.['application/json']?.schema) {
        requestSchema = pathItem.request.content['application/json'].schema;

        if (requestSchema.properties) {
          Object.entries(requestSchema.properties).forEach(([key, value]: [string, any]) => {
            inputProperties[key] = {
              type: value.type || 'any',
              description: value.description || '',
              'x-tool-description': value.description || key
            };
          });
        }

        if (requestSchema.required && Array.isArray(requestSchema.required)) {
          inputRequired.push(...requestSchema.required);
        }
      }

      const responseToProcess =
        pathItem.response?.['200'] ||
        pathItem.response?.['201'] ||
        pathItem.response?.['202'] ||
        pathItem.response?.default;

      if (responseToProcess?.content?.['application/json']?.schema) {
        const responseSchema = responseToProcess.content['application/json'].schema;
        if (responseSchema.properties) {
          Object.entries(responseSchema.properties).forEach(([key, value]: [string, any]) => {
            outputProperties[key] = {
              type: value.type || 'any',
              description: value.description || ''
            };
          });
        }
        if (responseSchema.required && Array.isArray(responseSchema.required)) {
          outputRequired.push(...responseSchema.required);
        }
      }

      return {
        name: pathItem.name,
        description: pathItem.description || pathItem.name,
        path,
        method: pathItem.method?.toLowerCase(),
        requestSchema,
        ...(staticParams.length > 0 && { staticParams }),
        inputSchema: {
          type: 'object',
          properties: inputProperties,
          required: inputRequired
        },
        outputSchema: {
          type: 'object',
          properties: outputProperties,
          required: outputRequired
        }
      };
    });
  } catch (error) {
    console.error('Error converting API schema to tool list:', error);
    return [];
  }
};

const splitPathAndStaticParams = (path: string) => {
  const [pathWithoutQuery, queryString] = path.split('?');
  const staticParams: NonNullable<HttpToolConfigType['staticParams']> = [];

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      if (value !== '') {
        addStaticParam(staticParams, key, value);
      }
    });
  }

  return {
    path: pathWithoutQuery || path,
    staticParams
  };
};

const addStaticParam = (
  staticParams: NonNullable<HttpToolConfigType['staticParams']>,
  key: string,
  value: string
) => {
  if (!hasStaticParam(staticParams, key)) {
    staticParams.push({ key, value });
  }
};

const hasStaticParam = (
  staticParams: NonNullable<HttpToolConfigType['staticParams']>,
  key: string
) => staticParams.some((param) => param.key === key);

const getOpenApiStaticQueryValue = (param: any) => {
  if (param.in !== 'query') return undefined;

  // OpenAPI 文档中带固定示例值的 query 参数，导入为静态 Params，而不是工具输入。
  const value =
    param.example ??
    param.schema?.default ??
    param.schema?.const ??
    getFirstOpenApiExampleValue(param.examples ?? param.schema?.examples);

  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
};

const getFirstOpenApiExampleValue = (examples: any) => {
  if (!examples) return undefined;

  if (Array.isArray(examples)) {
    return examples[0];
  }

  if (typeof examples === 'object') {
    const firstExample = Object.values(examples)[0] as any;
    return firstExample?.value ?? firstExample;
  }

  return undefined;
};
