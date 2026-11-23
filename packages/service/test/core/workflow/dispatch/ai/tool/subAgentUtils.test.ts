import { describe, expect, it } from 'vitest';
import {
  normalizeWhitelist,
  matchPoolByWhitelist,
  mergeToolNodes,
  buildToolPoolCatalog,
  splitPoolForLLM,
  restoreToolStartParams,
  readDirectOutput
} from '@fastgpt/service/core/workflow/dispatch/ai/tool/subAgentUtils';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import type { ToolNodeItemType } from '@fastgpt/service/core/workflow/dispatch/ai/tool/type';

const tool = (nodeId: string, name: string, intro = ''): ToolNodeItemType => ({
  nodeId,
  name,
  flowNodeType: FlowNodeTypeEnum.skill,
  intro,
  toolParams: []
});

describe('normalizeWhitelist', () => {
  it('handles array / comma string / chinese comma / JSON string / newlines / empty', () => {
    expect(normalizeWhitelist(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeWhitelist('a,b，c、d\ne')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(normalizeWhitelist('["a","b"]')).toEqual(['a', 'b']);
    expect(normalizeWhitelist(' a , a ,b ')).toEqual(['a', 'b']);
    expect(normalizeWhitelist('')).toEqual([]);
    expect(normalizeWhitelist(null)).toEqual([]);
    expect(normalizeWhitelist(undefined)).toEqual([]);
    expect(normalizeWhitelist(123)).toEqual([]);
  });
});

describe('matchPoolByWhitelist', () => {
  const pool = [tool('idA', '财务:报销'), tool('idB', '财务:发票'), tool('idC', '人事:请假')];

  it('empty whitelist selects nothing (own tools remain)', () => {
    expect(matchPoolByWhitelist(pool, []).selected).toEqual([]);
    expect(matchPoolByWhitelist(pool, '').selected).toEqual([]);
  });

  it('matches by name case-insensitively and by id', () => {
    const { selected, misses } = matchPoolByWhitelist(pool, ['财务:报销', 'IDC']);
    expect(selected.map((t) => t.nodeId)).toEqual(['idA']);
    expect(misses).toEqual(['IDC']);
  });

  it('duplicate names give all matches', () => {
    const dup = [tool('x1', '同名'), tool('x2', '同名')];
    const { selected } = matchPoolByWhitelist(dup, ['同名']);
    expect(selected.map((t) => t.nodeId)).toEqual(['x1', 'x2']);
  });

  it('reports misses for unknown names', () => {
    const { selected, misses } = matchPoolByWhitelist(pool, ['不存在']);
    expect(selected).toEqual([]);
    expect(misses).toEqual(['不存在']);
  });
});

describe('mergeToolNodes', () => {
  it('dedupes by nodeId with own-edge priority', () => {
    const own = [tool('a', 'ownA')];
    const added = [tool('a', 'poolA'), tool('b', 'poolB')];
    const merged = mergeToolNodes(own, added);
    expect(merged.map((t) => t.nodeId)).toEqual(['a', 'b']);
    expect(merged[0].name).toBe('ownA');
  });
});

describe('buildToolPoolCatalog / splitPoolForLLM', () => {
  const sub = { ...tool('sub1', '财务子代理'), flowNodeType: FlowNodeTypeEnum.subAgent };
  const t1 = tool('idA', '财务:报销', '报销流程与标准说明'.repeat(10));
  const t2 = tool('idB', '人事:请假');

  it('catalog contains name/id/truncated intro and hook guidance', () => {
    const catalog = buildToolPoolCatalog([t1, t2]);
    expect(catalog).toContain('名称: 财务:报销 | id: idA');
    expect(catalog).toContain('directOutput');
    expect(catalog).toContain('toolWhitelist');
    expect(catalog).not.toContain('报销流程与标准说明'.repeat(10));
    expect(buildToolPoolCatalog([])).toBe('');
  });

  it('poolMode hides non-subAgent tools; degrades without sub-agent', () => {
    const active = splitPoolForLLM([sub, t1, t2], true);
    expect(active.llmToolNodes.map((t) => t.nodeId)).toEqual(['sub1']);
    expect(active.catalog).toContain('idA');

    const noSub = splitPoolForLLM([t1, t2], true);
    expect(noSub.llmToolNodes.length).toBe(2);
    expect(noSub.catalog).toBe('');

    const off = splitPoolForLLM([sub, t1], false);
    expect(off.llmToolNodes.length).toBe(2);
    expect(off.catalog).toBe('');
  });

  it('visibleToMain tools stay callable by main node in poolMode', () => {
    const finished = { ...tool('idC', '成品报告'), visibleToMain: true };
    const active = splitPoolForLLM([sub, t1, finished], true);
    expect(active.llmToolNodes.map((t) => t.nodeId)).toEqual(['sub1', 'idC']);
    expect(active.catalog).toContain('idA');
    expect(active.catalog).not.toContain('成品报告');
  });
});

describe('restoreToolStartParams', () => {
  const messages: any[] = [
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'tool1', arguments: '{"a":1}' } }
      ]
    }
  ];

  it('restores arguments for matching call and entry', () => {
    expect(restoreToolStartParams(messages, 'c1', ['tool1'])).toEqual({ a: 1 });
  });

  it('guards on entryNodeIds and missing call', () => {
    expect(restoreToolStartParams(messages, 'c1', ['other'])).toBeUndefined();
    expect(restoreToolStartParams(messages, 'nope', ['tool1'])).toBeUndefined();
    expect(restoreToolStartParams([], 'c1', ['tool1'])).toBeUndefined();
  });
});

describe('readDirectOutput', () => {
  const node: any = {
    nodeId: 'n',
    inputs: [{ key: 'directOutput', value: true }]
  };

  it('params override node default; node default fallback; false fallback', () => {
    expect(readDirectOutput(node, { directOutput: false })).toBe(false);
    expect(readDirectOutput(node, {})).toBe(true);
    expect(readDirectOutput(node, undefined)).toBe(true);
    expect(readDirectOutput(undefined, undefined)).toBe(false);
    expect(readDirectOutput({ inputs: [] } as any, { directOutput: true })).toBe(true);
  });
});
