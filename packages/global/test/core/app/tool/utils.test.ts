import { describe, expect, it } from 'vitest';
import {
  getTeamPluginSource,
  getToolIdentityKey,
  getToolNameCandidates,
  getToolRawId,
  getToolSetChildDescription,
  hasDebugToolInNodes,
  hasDebugToolInSelectedTools,
  isTeamPluginSource,
  mergeToolSetChildConfigs,
  parseDebugToolSource,
  parseTeamPluginSource,
  parseToolsetToolId,
  shouldUseLegacyToolDescriptionFallback,
  splitCombineToolId,
  splitToolsetToolPluginId,
  toModelSafeToolId
} from '@fastgpt/global/core/app/tool/utils';
import { AppToolSourceEnum } from '@fastgpt/global/core/app/tool/constants';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';

describe('tool set child descriptions', () => {
  it('uses definitions for falsy values except an explicitly empty description', () => {
    expect(getToolSetChildDescription(undefined, 'Definition description')).toBe(
      'Definition description'
    );
    expect(getToolSetChildDescription(null, 'Definition description')).toBe(
      'Definition description'
    );
    expect(getToolSetChildDescription(false, 'Definition description')).toBe(
      'Definition description'
    );
    expect(getToolSetChildDescription(0, 'Definition description')).toBe('Definition description');
    expect(getToolSetChildDescription('', 'Definition description')).toBe('');
    expect(getToolSetChildDescription('  ', 'Definition description')).toBe('  ');
    expect(getToolSetChildDescription(' Custom description ', 'Definition description')).toBe(
      ' Custom description '
    );
  });

  it('preserves saved system descriptions by tool id and external descriptions by name', () => {
    const savedToolConfig = {
      systemToolSet: {
        toolId: 'system-tool-set',
        toolList: [
          { toolId: 'search', name: 'Old search', description: 'Custom system description' },
          { toolId: 'removed', name: 'Removed', description: 'Removed description' }
        ]
      },
      mcpToolSet: {
        url: 'https://example.com/mcp',
        toolList: [
          { name: 'search', description: 'Custom MCP description' },
          { name: 'blank', description: '  ' }
        ]
      },
      httpToolSet: {
        toolList: [
          { name: 'search', description: 'Custom HTTP description' },
          { name: 'blank', description: '' }
        ]
      }
    } as any;
    const templateToolConfig = {
      systemToolSet: {
        toolId: 'system-tool-set',
        toolList: [
          { toolId: 'search', name: 'New search', description: 'System default' },
          { toolId: 'new', name: 'New', description: 'New system default' }
        ]
      },
      mcpToolSet: {
        url: 'https://example.com/mcp',
        toolList: [
          { name: 'search', description: 'MCP default' },
          { name: 'blank', description: 'Blank MCP default' },
          { name: 'new', description: 'New MCP default' }
        ]
      },
      httpToolSet: {
        toolList: [
          { name: 'search', description: 'HTTP default' },
          { name: 'blank', description: 'Blank HTTP default' },
          { name: 'new', description: 'New HTTP default' }
        ]
      }
    } as any;

    expect(mergeToolSetChildConfigs({ savedToolConfig, templateToolConfig })).toMatchObject({
      systemToolSet: {
        toolList: [
          { toolId: 'search', description: 'Custom system description' },
          { toolId: 'new', description: 'New system default' }
        ]
      },
      mcpToolSet: {
        toolList: [
          { name: 'search', description: 'Custom MCP description' },
          { name: 'blank', description: '  ' },
          { name: 'new', description: 'New MCP default' }
        ]
      },
      httpToolSet: {
        toolList: [
          { name: 'search', description: 'Custom HTTP description' },
          { name: 'blank', description: '' },
          { name: 'new', description: 'New HTTP default' }
        ]
      }
    });
  });
});

describe('shouldUseLegacyToolDescriptionFallback', () => {
  it('only enables fallback for workflow, system and commercial tools', () => {
    expect(
      shouldUseLegacyToolDescriptionFallback({
        toolId: 'personal-tool',
        flowNodeType: FlowNodeTypeEnum.pluginModule
      })
    ).toBe(true);
    expect(shouldUseLegacyToolDescriptionFallback({ toolId: 'systemTool-search' })).toBe(true);
    expect(shouldUseLegacyToolDescriptionFallback({ toolId: 'commercial-search' })).toBe(true);
    expect(shouldUseLegacyToolDescriptionFallback({ toolId: 'mcp-app/search' })).toBe(false);
    expect(shouldUseLegacyToolDescriptionFallback({ toolId: 'http-app/search' })).toBe(false);
  });
});

describe('splitCombineToolId', () => {
  describe('personal tools (pure ObjectId)', () => {
    it('should parse pure ObjectId as personal tool', () => {
      const result = splitCombineToolId('507f1f77bcf86cd799439011');

      expect(result.source).toBe(AppToolSourceEnum.personal);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011');
    });

    it('should handle short ObjectId', () => {
      const result = splitCombineToolId('abc123');

      expect(result.source).toBe(AppToolSourceEnum.personal);
      expect(result.pluginId).toBe('abc123');
    });
  });

  describe('personal tools with prefix', () => {
    it('should parse personal-xxx format correctly', () => {
      const result = splitCombineToolId('personal-507f1f77bcf86cd799439011');

      expect(result.source).toBe(AppToolSourceEnum.personal);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011');
    });
  });

  describe('commercial tools', () => {
    it('should parse commercial-xxx format correctly', () => {
      const result = splitCombineToolId('commercial-507f1f77bcf86cd799439011');

      expect(result.source).toBe(AppToolSourceEnum.commercial);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011');
    });

    it('should convert commercial-dalle3 to systemTool(Adapt)', () => {
      const result = splitCombineToolId('commercial-dalle3');

      expect(result.source).toBe(AppToolSourceEnum.systemTool);
      expect(result.pluginId).toBe('dalle3');
    });
  });

  describe('systemTool tools', () => {
    it('should parse systemTool-xxx format correctly', () => {
      const result = splitCombineToolId('systemTool-websearch');

      expect(result.source).toBe(AppToolSourceEnum.systemTool);
      expect(result.pluginId).toBe('websearch');
    });

    it('should handle systemTool with complex id', () => {
      const result = splitCombineToolId('systemTool-code-interpreter');

      expect(result.source).toBe(AppToolSourceEnum.systemTool);
      expect(result.pluginId).toBe('code-interpreter');
    });
  });

  describe('mcp tools', () => {
    it('should parse mcp-appId format correctly', () => {
      const result = splitCombineToolId('mcp-507f1f77bcf86cd799439011');

      expect(result.source).toBe(AppToolSourceEnum.mcp);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011');
      expect(result.authAppId).toBe('507f1f77bcf86cd799439011');
    });

    it('should parse mcp-appId/toolName format correctly', () => {
      const result = splitCombineToolId('mcp-507f1f77bcf86cd799439011/searchTool');

      expect(result.source).toBe(AppToolSourceEnum.mcp);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011/searchTool');
      expect(result.authAppId).toBe('507f1f77bcf86cd799439011');
    });
  });

  describe('http tools', () => {
    it('should parse http-parentId format correctly', () => {
      const result = splitCombineToolId('http-507f1f77bcf86cd799439011');

      expect(result.source).toBe(AppToolSourceEnum.http);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011');
      expect(result.authAppId).toBe('507f1f77bcf86cd799439011');
    });

    it('should parse http-parentId/toolName format correctly', () => {
      const result = splitCombineToolId('http-507f1f77bcf86cd799439011/apiTool');

      expect(result.source).toBe(AppToolSourceEnum.http);
      expect(result.pluginId).toBe('507f1f77bcf86cd799439011/apiTool');
    });
  });

  describe('deprecated community tools', () => {
    it('should convert community-xxx to systemTool', () => {
      const result = splitCombineToolId('community-oldPlugin');

      expect(result.source).toBe(AppToolSourceEnum.systemTool);
      expect(result.pluginId).toBe('oldPlugin');
    });
  });

  describe('error handling', () => {
    it('should throw error when pluginId is empty after split', () => {
      expect(() => splitCombineToolId('commercial-')).toThrow('toolId not found');
    });
  });
});

describe('parseDebugToolSource', () => {
  it('should parse stable tmb debug source', () => {
    expect(parseDebugToolSource('debug:tmbId:tmb-1')).toEqual({
      tmbId: 'tmb-1'
    });
  });

  it('should ignore invalid debug source', () => {
    expect(parseDebugToolSource('debug:invalid')).toBeUndefined();
    expect(parseDebugToolSource('debug:tmbId:tmb-1:session:dbg-1')).toBeUndefined();
    expect(parseDebugToolSource('system')).toBeUndefined();
  });

  it('does not parse debug source from combined tool id', () => {
    expect(() => splitCombineToolId('debug:tmbId:tmb-1|weather')).toThrow('Invalid tool id');
  });
});

describe('team plugin source', () => {
  it('builds and parses a stable team source', () => {
    const source = getTeamPluginSource('team-1');

    expect(source).toBe('teamId:team-1');
    expect(isTeamPluginSource(source)).toBe(true);
    expect(parseTeamPluginSource(source)).toEqual({ teamId: 'team-1' });
  });

  it('rejects malformed team sources', () => {
    expect(parseTeamPluginSource('team')).toBeUndefined();
    expect(parseTeamPluginSource('teamId:team-1:extra')).toBeUndefined();
    expect(parseTeamPluginSource('system')).toBeUndefined();
  });
});

describe('getToolIdentityKey', () => {
  it('keeps system and team tools with the same id distinct', () => {
    const id = 'systemTool-weather';
    const systemKey = getToolIdentityKey(id, 'system');
    const teamKey = getToolIdentityKey(id, 'teamId:team-1');

    expect(systemKey).not.toBe(teamKey);
  });

  it('treats missing source as system source', () => {
    expect(getToolIdentityKey('systemTool-weather', undefined)).toBe(
      getToolIdentityKey('systemTool-weather', 'system')
    );
  });
});

describe('debug tool detection', () => {
  it('detects explicit debug source in selected tools', () => {
    expect(
      hasDebugToolInSelectedTools([
        {
          id: 'node-id',
          pluginId: 'systemTool-weather',
          source: 'debug:tmbId:tmb-1'
        } as any
      ])
    ).toBe(true);
  });

  it('ignores debug-looking ids without explicit debug source', () => {
    expect(
      hasDebugToolInSelectedTools([
        {
          id: 'debug:tmbId:tmb-1|node-id',
          pluginId: 'debug:tmbId:tmb-1|weather'
        } as any
      ])
    ).toBe(false);
  });

  it('detects explicit debug source in workflow nodes', () => {
    expect(
      hasDebugToolInNodes([
        {
          pluginId: 'systemTool-weather',
          source: 'debug:tmbId:tmb-1',
          inputs: []
        } as any
      ])
    ).toBe(true);
  });
});

describe('getToolRawId', () => {
  it('should return pluginId for pure ObjectId', () => {
    const result = getToolRawId('507f1f77bcf86cd799439011');
    expect(result).toBe('507f1f77bcf86cd799439011');
  });

  it('should return pluginId for commercial tool', () => {
    const result = getToolRawId('commercial-507f1f77bcf86cd799439011');
    expect(result).toBe('507f1f77bcf86cd799439011');
  });

  it('should return parentId for mcp tool with toolName', () => {
    const result = getToolRawId('mcp-507f1f77bcf86cd799439011/searchTool');
    expect(result).toBe('507f1f77bcf86cd799439011');
  });

  it('should return parentId for http tool with toolName', () => {
    const result = getToolRawId('http-507f1f77bcf86cd799439011/apiTool');
    expect(result).toBe('507f1f77bcf86cd799439011');
  });

  it('should handle systemTool correctly', () => {
    const result = getToolRawId('systemTool-websearch');
    expect(result).toBe('websearch');
  });

  it('should handle personal tool with prefix', () => {
    const result = getToolRawId('personal-507f1f77bcf86cd799439011');
    expect(result).toBe('507f1f77bcf86cd799439011');
  });

  it('should handle converted community tool', () => {
    const result = getToolRawId('community-oldPlugin');
    expect(result).toBe('oldPlugin');
  });
});

describe('splitToolsetToolPluginId', () => {
  it('should preserve slashes inside tool name', () => {
    const result = splitToolsetToolPluginId('toolset-abc/namespace/nestedTool');

    expect(result).toEqual({
      parentId: 'toolset-abc',
      toolName: 'namespace/nestedTool'
    });
  });

  it('should preserve leading slash in tool name', () => {
    const result = splitToolsetToolPluginId('69e20f48dbec7c6ece77556b//test');

    expect(result).toEqual({
      parentId: '69e20f48dbec7c6ece77556b',
      toolName: '/test'
    });
  });
});

describe('parseToolsetToolId', () => {
  it('should parse combined HTTP tool id and preserve leading slash in tool name', () => {
    const result = parseToolsetToolId('http-69e20f48dbec7c6ece77556b//test');

    expect(result).toEqual({
      parentId: '69e20f48dbec7c6ece77556b',
      toolName: '/test'
    });
  });
});

describe('getToolNameCandidates', () => {
  it('should prefer full tool name and fallback to last segment for legacy ids', () => {
    expect(getToolNameCandidates('toolset/tool')).toEqual(['toolset/tool', 'tool']);
  });

  it('should preserve leading slash name before fallback', () => {
    expect(getToolNameCandidates('/test')).toEqual(['/test', 'test']);
  });
});

describe('toModelSafeToolId', () => {
  it('keeps pure ASCII ids unchanged for backward compatibility', () => {
    expect(toModelSafeToolId('systemTool-getTime')).toBe('systemTool-getTime');
    expect(toModelSafeToolId('mcp-507f1f77bcf86cd799439011-searchTool')).toBe(
      'mcp-507f1f77bcf86cd799439011-searchTool'
    );
  });

  it('appends a stable hash suffix for non-ASCII ids', () => {
    const id = 'mcp-507f1f77bcf86cd799439011/根据条件查询各地区信访量及同比情况';
    const result = toModelSafeToolId(id);

    expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.startsWith('mcp-507f1f77bcf86cd799439011-')).toBe(true);
    // 确定性：同一 ID 多次计算结果一致，保证模型 schema 与调用路由匹配。
    expect(toModelSafeToolId(id)).toBe(result);
  });

  it('generates distinct ids for different Chinese tool names sharing the same prefix', () => {
    const prefix = 'mcp-507f1f77bcf86cd799439011/';
    const names = [
      '根据条件查询各内容分类信访量情况',
      '根据条件查询信访量月度变化趋势',
      '根据条件查询各地区信访量及同比情况',
      '根据条件查询各信访层级占比情况',
      '根据条件查询各信访目的信访量占比情况',
      '根据条件查询各信访形式初重件情况',
      '根据条件查询各地区信访量分布情况'
    ];
    const ids = names.map((name) => toModelSafeToolId(prefix + name));

    expect(new Set(ids).size).toBe(names.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/));
  });
});

describe('mergeToolSetChildConfigs modelName preservation', () => {
  it('preserves saved MCP model names across re-parse and leaves new tools unconfigured', () => {
    const savedToolConfig = {
      mcpToolSet: {
        url: 'https://example.com/mcp',
        toolList: [
          { name: '查询信访量', description: 'saved', modelName: 'query_xf' },
          { name: 'removed', description: 'removed', modelName: 'removed_model' }
        ]
      }
    } as any;
    const templateToolConfig = {
      mcpToolSet: {
        url: 'https://example.com/mcp',
        toolList: [
          { name: '查询信访量', description: 'MCP default' },
          { name: 'newTool', description: 'New MCP default' }
        ]
      }
    } as any;

    const merged = mergeToolSetChildConfigs({ savedToolConfig, templateToolConfig });

    expect(merged?.mcpToolSet?.toolList).toEqual([
      { name: '查询信访量', description: 'saved', modelName: 'query_xf' },
      { name: 'newTool', description: 'New MCP default' }
    ]);
  });
});
