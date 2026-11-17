import { describe, expect, it } from 'vitest';
import {
  getMCPToolSetRuntimeNode,
  getMCPToolRuntimeNode,
  getMCPToolErrorText,
  parsetMcpToolConfig,
  getMcpModelNodeId,
  findDuplicateModelName
} from '@fastgpt/global/core/app/tool/mcpTool/utils';
import {
  McpToolConfigSchema,
  MCP_TOOL_MODEL_NAME_REGEX
} from '@fastgpt/global/core/app/tool/mcpTool/type';
import {
  FlowNodeTypeEnum,
  FlowNodeOutputTypeEnum
} from '@fastgpt/global/core/workflow/node/constant';
import {
  NodeOutputKeyEnum,
  WorkflowIOValueTypeEnum
} from '@fastgpt/global/core/workflow/constants';
import { AppToolSourceEnum } from '@fastgpt/global/core/app/tool/constants';
import type { McpToolConfigType } from '@fastgpt/global/core/app/tool/mcpTool/type';

describe('mcpTool utils', () => {
  describe('getMCPToolErrorText', () => {
    it.each([
      { result: {}, expected: undefined },
      {
        result: { isError: false, content: [{ type: 'text', text: 'error' }] },
        expected: undefined
      },
      { result: { isError: false, error: 'business value' }, expected: undefined },
      {
        result: {
          isError: true,
          content: [
            { type: 'text', text: 'First failure' },
            { type: 'image' },
            { type: 'text', text: 'Second failure' }
          ]
        },
        expected: 'First failure\nSecond failure'
      },
      { result: { isError: true }, expected: 'MCP tool execution failed' },
      {
        result: { isError: true, content: [{ type: 'text', text: '  ' }, { type: 'image' }] },
        expected: 'MCP tool execution failed'
      }
    ])('extracts only protocol errors: $expected', ({ result, expected }) => {
      expect(getMCPToolErrorText(result)).toBe(expected);
    });
  });

  describe('getMCPToolSetRuntimeNode', () => {
    it('should create runtime node with required params', () => {
      const toolList: McpToolConfigType[] = [
        {
          name: 'searchTool',
          description: 'Search tool',
          inputSchema: { type: 'object', properties: {}, required: [] }
        }
      ];

      const result = getMCPToolSetRuntimeNode({
        url: 'https://mcp.example.com/api',
        toolList
      });

      expect(result.flowNodeType).toBe(FlowNodeTypeEnum.toolSet);
      expect(result.intro).toBe('MCP Tools');
      expect(result.inputs).toEqual([]);
      expect(result.outputs).toEqual([]);
      expect(result.name).toBe('');
      expect(result.nodeId).toHaveLength(16);
      expect(result.toolConfig?.mcpToolSet?.url).toBe('https://mcp.example.com/api');
      expect(result.toolConfig?.mcpToolSet?.toolList).toEqual(toolList);
    });

    it('should create runtime node with all optional params', () => {
      const toolList: McpToolConfigType[] = [];

      const result = getMCPToolSetRuntimeNode({
        url: 'https://mcp.example.com/api',
        toolList,
        name: 'My MCP Tools',
        avatar: 'custom-mcp-avatar',
        headerSecret: { id: 'secret-1', key: 'Authorization' }
      });

      expect(result.name).toBe('My MCP Tools');
      expect(result.avatar).toBe('custom-mcp-avatar');
      expect(result.toolConfig?.mcpToolSet?.headerSecret).toEqual({
        id: 'secret-1',
        key: 'Authorization'
      });
    });
  });

  describe('getMCPToolRuntimeNode', () => {
    it('should create tool runtime node with required params', () => {
      const tool: McpToolConfigType = {
        name: 'searchTool',
        description: 'Search for information',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      };

      const result = getMCPToolRuntimeNode({
        tool,
        nodeId: 'node-123',
        toolSetId: 'toolset-456',
        toolsetName: 'toolsetName'
      });

      expect(result.nodeId).toBe('node-123');
      expect(result.flowNodeType).toBe(FlowNodeTypeEnum.tool);
      expect(result.avatar).toBe('core/app/type/mcpToolsFill');
      expect(result.intro).toBe('Search for information');
      expect(result.name).toBe('toolsetName/searchTool');
      expect(result.toolConfig?.mcpTool?.toolId).toBe(
        `${AppToolSourceEnum.mcp}-toolset-456/searchTool`
      );
      expect(result.inputs[0]).toMatchObject({ defaultToAgentGenerated: true });
    });

    it('should create tool runtime node with custom avatar', () => {
      const tool: McpToolConfigType = {
        name: 'customTool',
        description: 'Custom tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      };

      const result = getMCPToolRuntimeNode({
        tool,
        nodeId: 'node-789',
        avatar: 'custom-icon',
        toolSetId: 'toolset-abc',
        toolsetName: 'toolsetName'
      });

      expect(result.avatar).toBe('custom-icon');
    });

    it('should include rawResponse output', () => {
      const tool: McpToolConfigType = {
        name: 'apiTool',
        description: 'API tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      };

      const result = getMCPToolRuntimeNode({
        tool,
        nodeId: 'node-001',
        toolSetId: 'toolset-002',
        toolsetName: 'toolsetName'
      });

      expect(result.outputs).toHaveLength(1);
      const rawResponseOutput = result.outputs[0];
      expect(rawResponseOutput.key).toBe(NodeOutputKeyEnum.rawResponse);
      expect(rawResponseOutput.valueType).toBe(WorkflowIOValueTypeEnum.any);
      expect(rawResponseOutput.type).toBe(FlowNodeOutputTypeEnum.static);
      expect(rawResponseOutput.required).toBe(true);
    });

    it('should generate correct toolId format', () => {
      const tool: McpToolConfigType = {
        name: 'myTool',
        description: 'My tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      };

      const result = getMCPToolRuntimeNode({
        tool,
        nodeId: 'node-test',
        toolSetId: 'parent-123',
        toolsetName: 'toolsetName'
      });

      expect(result.toolConfig?.mcpTool?.toolId).toBe('mcp-parent-123/myTool');
    });
  });

  describe('parsetMcpToolConfig', () => {
    it('should parse toolsetId and toolName from a valid toolId', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-toolset-456/someTool'
      });

      expect(result).toEqual({ toolsetId: 'toolset-456', toolName: 'someTool' });
    });

    it('should return undefined when toolId does not match mcp- prefix pattern', () => {
      const result = parsetMcpToolConfig({
        toolId: 'system-foo/bar'
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when toolId has no slash separator', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-toolset-no-tool'
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when toolsetId segment is empty in toolId', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-/toolName'
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when toolId is empty string', () => {
      const result = parsetMcpToolConfig({
        toolId: ''
      });

      expect(result).toBeUndefined();
    });

    it('should preserve slashes inside tool name', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-toolset-abc/namespace/nestedTool'
      });

      expect(result).toEqual({ toolsetId: 'toolset-abc', toolName: 'namespace/nestedTool' });
    });

    it('should preserve multiple slashes inside tool name', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-toolset-xyz/a/b/c/d'
      });

      expect(result).toEqual({ toolsetId: 'toolset-xyz', toolName: 'a/b/c/d' });
    });

    it('should preserve leading slash in tool name', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-69e20f48dbec7c6ece77556b//test'
      });

      expect(result).toEqual({
        toolsetId: '69e20f48dbec7c6ece77556b',
        toolName: '/test'
      });
    });

    it('should return undefined when toolName segment is empty in toolId', () => {
      const result = parsetMcpToolConfig({
        toolId: 'mcp-toolset-abc/'
      });

      expect(result).toBeUndefined();
    });
  });
});

describe('MCP tool modelName', () => {
  describe('McpToolConfigSchema', () => {
    it('accepts tools without modelName (backward compatible)', () => {
      const result = McpToolConfigSchema.safeParse({ name: '查询', description: 'desc' });
      expect(result.success).toBe(true);
    });

    it('accepts valid ASCII modelName and rejects invalid values', () => {
      expect(
        McpToolConfigSchema.safeParse({
          name: '查询',
          description: 'desc',
          modelName: 'query_xf-by_region'
        }).success
      ).toBe(true);

      // 中文、空格、超长均不合法
      expect(
        McpToolConfigSchema.safeParse({ name: '查询', description: 'd', modelName: '查询模型' })
          .success
      ).toBe(false);
      expect(
        McpToolConfigSchema.safeParse({ name: '查询', description: 'd', modelName: 'has space' })
          .success
      ).toBe(false);
      expect(
        McpToolConfigSchema.safeParse({ name: '查询', description: 'd', modelName: 'a'.repeat(36) })
          .success
      ).toBe(false);
    });
  });

  describe('getMcpModelNodeId', () => {
    it('prefixes toolset id and stays within the 64-char model API limit', () => {
      const toolSetId = '507f1f77bcf86cd799439011';
      const nodeId = getMcpModelNodeId({ toolSetId, modelName: 'a'.repeat(35) });

      expect(nodeId).toBe(`mcp-${toolSetId}-${'a'.repeat(35)}`);
      expect(nodeId.length).toBeLessThanOrEqual(64);
      expect(nodeId).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('keeps identical modelNames from different toolsets distinct', () => {
      const a = getMcpModelNodeId({ toolSetId: '507f1f77bcf86cd799439011', modelName: 'query' });
      const b = getMcpModelNodeId({ toolSetId: '507f1f77bcf86cd799439012', modelName: 'query' });
      expect(a).not.toBe(b);
    });
  });

  describe('findDuplicateModelName', () => {
    it('returns the first duplicate and ignores unconfigured tools', () => {
      expect(
        findDuplicateModelName([
          { modelName: 'query_a' },
          {},
          { modelName: '' },
          { modelName: 'query_a' }
        ])
      ).toBe('query_a');
    });

    it('returns undefined when all configured names are unique', () => {
      expect(
        findDuplicateModelName([{ modelName: 'query_a' }, { modelName: 'query_b' }, {}])
      ).toBeUndefined();
      expect(findDuplicateModelName([])).toBeUndefined();
    });
  });

  describe('MCP_TOOL_MODEL_NAME_REGEX', () => {
    it('matches the schema constraint', () => {
      expect(MCP_TOOL_MODEL_NAME_REGEX.test('query_xf-1')).toBe(true);
      expect(MCP_TOOL_MODEL_NAME_REGEX.test('')).toBe(false);
      expect(MCP_TOOL_MODEL_NAME_REGEX.test('中文名')).toBe(false);
    });
  });
});
