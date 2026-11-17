import z from 'zod';
import { OpenObjectOpenApiMeta } from '../../../../common/zod/openapi';
import { ObjectIdSchema } from '../../../../common/type/mongo';
import { StoreSecretValueTypeApiInputSchema } from '../../../../common/secret/utils';
import { CreateAppBodySchema } from '../common/api';
import { McpToolConfigSchema } from '../../../../core/app/tool/mcpTool/type';
import { findDuplicateModelName } from '../../../../core/app/tool/mcpTool/utils';

/** 工具集内模型名称必须唯一，否则 Agent 合并工具列表时模型 API 会拒绝重名工具。 */
const refineUniqueModelNames = (
  val: { toolList: Array<{ modelName?: string }> },
  ctx: z.RefinementCtx
) => {
  const duplicate = findDuplicateModelName(val.toolList);
  if (duplicate !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['toolList'],
      message: `Duplicate modelName: ${duplicate}`
    });
  }
};

// Create mcp tool
export const CreateMcpToolsBodySchema = CreateAppBodySchema.omit({
  type: true,
  nodes: true,
  edges: true,
  chatConfig: true
})
  .extend({
    url: z.string().meta({
      example: 'https://example.com/mcp',
      description: 'MCP 服务地址'
    }),
    headerSecret: StoreSecretValueTypeApiInputSchema.optional().meta({
      example: { Authorization: { value: 'token' } },
      description: '请求头密钥'
    }),
    toolList: z.array(McpToolConfigSchema).meta({
      example: [
        {
          name: 'search',
          description: 'Search tool',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      description: 'MCP 工具列表'
    })
  })
  .superRefine(refineUniqueModelNames)
  .meta({
    example: {
      name: 'MCP 工具集',
      parentId: '68ad85a7463006c963799a05',
      url: 'https://example.com/mcp',
      toolList: []
    }
  });
export type CreateMcpToolsBodyType = z.infer<typeof CreateMcpToolsBodySchema>;

// Update mcp tool
export const UpdateMcpToolsBodySchema = z
  .object({
    appId: ObjectIdSchema.meta({
      example: '68ad85a7463006c963799a05',
      description: 'MCP 工具集 ID'
    }),
    url: CreateMcpToolsBodySchema.shape.url,
    headerSecret: CreateMcpToolsBodySchema.shape.headerSecret,
    toolList: CreateMcpToolsBodySchema.shape.toolList
  })
  .superRefine(refineUniqueModelNames)
  .meta({
    example: {
      appId: '68ad85a7463006c963799a05',
      url: 'https://example.com/mcp',
      headerSecret: {},
      toolList: []
    }
  });
export type UpdateMcpToolsBodyType = z.infer<typeof UpdateMcpToolsBodySchema>;

export const UpdateMcpToolsResponseSchema = z.undefined().meta({
  description: '更新成功'
});
export type UpdateMcpToolsResponseType = z.infer<typeof UpdateMcpToolsResponseSchema>;

// Get mcp children
export const GetMcpChildrenQuerySchema = z.object({
  id: ObjectIdSchema.meta({
    example: '68ad85a7463006c963799a05',
    description: 'MCP 工具集 ID'
  }),
  searchKey: z.string().optional().meta({
    example: 'search',
    description: '工具名称搜索关键词'
  })
});
export type GetMcpChildrenQueryType = z.infer<typeof GetMcpChildrenQuerySchema>;

export const McpChildrenItemSchema = McpToolConfigSchema.extend({
  id: z.string().meta({
    example: 'mcp-68ad85a7463006c963799a05/search',
    description: '工具 ID'
  }),
  avatar: z.string().meta({
    example: 'https://example.com/avatar.png',
    description: '工具头像'
  })
});
export type McpChildrenItemType = z.infer<typeof McpChildrenItemSchema>;

export const GetMcpChildrenResponseSchema = z.array(McpChildrenItemSchema).meta({
  example: [],
  description: 'MCP 工具列表'
});
export type GetMcpChildrenResponseType = z.infer<typeof GetMcpChildrenResponseSchema>;

// Get MCP tools from remote server
export const GetMcpToolsBodySchema = z
  .object({
    url: z.string().meta({
      example: 'https://example.com/mcp',
      description: 'MCP 服务地址'
    }),
    headerSecret: StoreSecretValueTypeApiInputSchema.optional().meta({
      example: { Authorization: { value: 'token' } },
      description: '请求头密钥'
    })
  })
  .meta({
    example: {
      url: 'https://example.com/mcp',
      headerSecret: {}
    }
  });
export type GetMcpToolsBodyType = z.infer<typeof GetMcpToolsBodySchema>;

export const GetMcpToolsResponseSchema = z.array(McpToolConfigSchema).meta({
  example: [],
  description: 'MCP 工具配置列表'
});
export type GetMcpToolsResponseType = z.infer<typeof GetMcpToolsResponseSchema>;

// Run MCP tool
export const RunMcpToolBodySchema = z
  .object({
    url: z.string().meta({
      example: 'https://example.com/mcp',
      description: 'MCP 服务地址'
    }),
    toolName: z.string().meta({
      example: 'search',
      description: '工具名称'
    }),
    headerSecret: StoreSecretValueTypeApiInputSchema.optional().meta({
      example: { Authorization: { value: 'token' } },
      description: '请求头密钥'
    }),
    params: z.record(z.string(), z.any()).meta({
      example: { query: 'hello' },
      description: '工具调用参数'
    })
  })
  .meta({
    example: {
      url: 'https://example.com/mcp',
      toolName: 'search',
      headerSecret: {},
      params: { query: 'hello' }
    }
  });
export type RunMcpToolBodyType = z.infer<typeof RunMcpToolBodySchema>;

export const RunMcpToolResponseSchema = z.any().meta({
  ...OpenObjectOpenApiMeta,
  description: '工具调用结果（MCP CallToolResult 结构，内容随工具变化）'
});
export type RunMcpToolResponseType = z.infer<typeof RunMcpToolResponseSchema>;

// Generate ASCII model names for MCP tools via LLM
export const GenerateMcpModelNamesBodySchema = z
  .object({
    tools: z
      .array(
        z.object({
          name: z.string().meta({ example: '查询各地区信访量', description: '工具展示名' }),
          description: z.string().optional().meta({
            example: '按地区统计信访量',
            description: '工具描述'
          })
        })
      )
      .min(1)
      .max(50)
      .meta({ description: '待生成模型名称的工具列表' }),
    existingNames: z
      .array(z.string())
      .optional()
      .meta({
        example: ['query_monthly_trend'],
        description: '已占用的模型名称，生成结果需避开'
      })
  })
  .meta({
    example: {
      tools: [{ name: '查询各地区信访量', description: '按地区统计信访量' }],
      existingNames: []
    }
  });
export type GenerateMcpModelNamesBodyType = z.infer<typeof GenerateMcpModelNamesBodySchema>;

export const GenerateMcpModelNamesResponseSchema = z
  .object({
    modelNames: z.array(z.string()).meta({
      example: ['query_xf_by_region'],
      description: '与 tools 顺序一一对应的 ASCII 模型名称'
    })
  })
  .meta({ example: { modelNames: ['query_xf_by_region'] } });
export type GenerateMcpModelNamesResponseType = z.infer<typeof GenerateMcpModelNamesResponseSchema>;
