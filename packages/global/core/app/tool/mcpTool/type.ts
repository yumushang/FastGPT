import { SecretValueTypeSchema } from '../../../../common/secret/type';
import { JSONSchemaInputTypeSchema } from '../../jsonschema';
import z from 'zod';

/**
 * 模型侧工具名规则：仅 ASCII 字母/数字/下划线/短横线。
 * 上限 35 字符，运行时拼接 `mcp-<24位工具集ID>-` 前缀后不超过模型 API 的 64 字符工具名上限。
 */
export const MCP_TOOL_MODEL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,35}$/;

export const McpToolConfigSchema = z.object({
  name: z.string().meta({
    example: 'search',
    description: 'MCP 工具名称，用于工作流节点选择和远端调用'
  }),
  description: z.string().meta({
    example: 'Search tool',
    description: 'MCP 工具能力说明，会用于工具选择和调用提示'
  }),
  modelName: z.string().regex(MCP_TOOL_MODEL_NAME_REGEX).optional().meta({
    example: 'query_xf_by_region',
    description:
      '模型侧工具名（ASCII）。界面展示与远端调用始终使用 name；未配置时运行时自动生成唯一 ASCII 名，避免非 ASCII 工具名清洗后重名'
  }),
  inputSchema: JSONSchemaInputTypeSchema.optional().meta({
    description: 'MCP 工具入参 JSON Schema'
  })
});
export type McpToolConfigType = z.infer<typeof McpToolConfigSchema>;

export const McpToolSetDataTypeSchema = z.object({
  url: z.string(),
  headerSecret: SecretValueTypeSchema.optional(),
  toolList: z.array(McpToolConfigSchema)
});
export type McpToolSetDataType = z.infer<typeof McpToolSetDataTypeSchema>;

export const McpToolDataTypeSchema = McpToolConfigSchema.extend({
  url: z.string(),
  headerSecret: SecretValueTypeSchema.optional()
});
export type McpToolDataType = z.infer<typeof McpToolDataTypeSchema>;
