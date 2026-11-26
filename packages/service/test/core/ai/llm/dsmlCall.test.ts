import { describe, expect, it, vi } from 'vitest';
import {
  createDSMLStreamGuard,
  mergeToolCalls,
  parseDSMLToolCalls
} from '@fastgpt/service/core/ai/llm/dsmlCall';
import type {
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from '@fastgpt/global/core/ai/llm/type';

const appTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'xCbFfFeOx29XYGSh',
      description: '考核查询应用',
      parameters: {
        type: 'object',
        properties: {
          userChatInput: { type: 'string' },
          directOutput: { type: 'boolean' }
        }
      }
    }
  }
];

// 生产截图方言：单竖线 + calls 包络 + arguments/name 包装参数
const screenshotLeak = [
  '<｜DSML｜calls>',
  '<｜DSML｜invoke name="xCbFfFeOx29XYGSh">',
  '<｜DSML｜parameter name="arguments" string="true">{"userChatInput":"查询2026年连云港市各县区信访考核指标情况","directOutput":false}</｜DSML｜parameter>',
  '<｜DSML｜parameter name="name" string="true">xCbFfFeOx29XYGSh</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜calls>'
].join('\n');

const directCall = [
  '<｜DSML｜function_calls>',
  '<｜DSML｜invoke name="get_weather">',
  '<｜DSML｜parameter name="city" string="true">杭州</｜DSML｜parameter>',
  '<｜DSML｜parameter name="days" string="false">3</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜function_calls>'
].join('\n');

describe('parseDSMLToolCalls', () => {
  it('should recover screenshot dialect with wrapped arguments', () => {
    const { answer, toolCalls } = parseDSMLToolCalls(screenshotLeak, appTools);

    expect(answer).toBe('');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('xCbFfFeOx29XYGSh');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      userChatInput: '查询2026年连云港市各县区信访考核指标情况',
      directOutput: false
    });
  });

  it('should unwrap arguments without tools schema by name match', () => {
    const { toolCalls } = parseDSMLToolCalls(screenshotLeak);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('xCbFfFeOx29XYGSh');
    expect(JSON.parse(toolCalls[0].function.arguments).directOutput).toBe(false);
  });

  it('should parse direct parameters with string and json values', () => {
    const { answer, toolCalls } = parseDSMLToolCalls(directCall);

    expect(answer).toBe('');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('get_weather');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ city: '杭州', days: 3 });
  });

  it('should parse double-bar dialect', () => {
    const text = directCall.replaceAll('｜', '｜｜');
    const { toolCalls } = parseDSMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ city: '杭州', days: 3 });
  });

  it('should parse ascii bar dialect with spaces', () => {
    const text = directCall.replaceAll('｜', ' | ');
    const { toolCalls } = parseDSMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('get_weather');
  });

  it('should parse tool_calls envelope variant', () => {
    const text = directCall
      .replace('function_calls>', 'tool_calls>')
      .replace('</｜DSML｜function_calls>', '</｜DSML｜tool_calls>');
    const { toolCalls } = parseDSMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
  });

  it('should recover orphan invoke without envelope', () => {
    const text = [
      '<｜DSML｜invoke name="get_weather">',
      '<｜DSML｜parameter name="city" string="true">杭州</｜DSML｜parameter>',
      '</｜DSML｜invoke>'
    ].join('\n');
    const { answer, toolCalls } = parseDSMLToolCalls(text);

    expect(answer).toBe('');
    expect(toolCalls).toHaveLength(1);
  });

  it('should keep surrounding prose and strip markup', () => {
    const { answer, toolCalls } = parseDSMLToolCalls(`前置说明\n${directCall}\n后置说明`);

    expect(toolCalls).toHaveLength(1);
    expect(answer).toContain('前置说明');
    expect(answer).toContain('后置说明');
    expect(answer).not.toContain('DSML');
  });

  it('should recover multiple invokes in one envelope', () => {
    const invoke = (city: string) =>
      [
        '<｜DSML｜invoke name="get_weather">',
        `<｜DSML｜parameter name="city" string="true">${city}</｜DSML｜parameter>`,
        '</｜DSML｜invoke>'
      ].join('\n');
    const text = `<｜DSML｜calls>\n${invoke('杭州')}\n${invoke('南京')}\n</｜DSML｜calls>`;
    const { toolCalls } = parseDSMLToolCalls(text);

    expect(toolCalls).toHaveLength(2);
    expect(JSON.parse(toolCalls[1].function.arguments).city).toBe('南京');
  });

  it('should recover unclosed invoke at text end', () => {
    const text = [
      '<｜DSML｜calls>',
      '<｜DSML｜invoke name="get_weather">',
      '<｜DSML｜parameter name="city" string="true">杭州</｜DSML｜parameter>'
    ].join('\n');
    const { answer, toolCalls } = parseDSMLToolCalls(text);

    expect(answer).toBe('');
    expect(toolCalls).toHaveLength(1);
  });

  it('should keep direct layout when schema declares arguments field', () => {
    const dispatcherTools: ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'call_tool',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string' }, arguments: { type: 'object' } }
          }
        }
      }
    ];
    const text = [
      '<｜DSML｜invoke name="call_tool">',
      '<｜DSML｜parameter name="arguments" string="false">{"deviceId":15}</｜DSML｜parameter>',
      '<｜DSML｜parameter name="name" string="true">inner_tool</｜DSML｜parameter>',
      '</｜DSML｜invoke>'
    ].join('\n');
    const { toolCalls } = parseDSMLToolCalls(text, dispatcherTools);

    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      arguments: { deviceId: 15 },
      name: 'inner_tool'
    });
  });

  it('should pass through text without DSML unchanged', () => {
    const text = '普通回答，包含 <div> 与 a < b 等符号。';
    const { answer, toolCalls } = parseDSMLToolCalls(text);

    expect(answer).toBe(text);
    expect(toolCalls).toEqual([]);
  });
});

describe('createDSMLStreamGuard', () => {
  const setup = () => {
    let streamed = '';
    const calls: ChatCompletionMessageToolCall[] = [];
    const guard = createDSMLStreamGuard({
      tools: appTools,
      onText: (text: string) => {
        streamed += text;
      },
      onToolCall: (call: ChatCompletionMessageToolCall) => calls.push(call)
    });
    return { guard, calls, getStreamed: () => streamed };
  };

  it('should suppress markup and recover call when split across chunks', () => {
    const { guard, calls, getStreamed } = setup();
    for (let i = 0; i < screenshotLeak.length; i += 7) {
      guard.push(screenshotLeak.slice(i, i + 7));
    }
    guard.flush();

    expect(getStreamed()).toBe('');
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('xCbFfFeOx29XYGSh');
  });

  it('should emit prose before and after the markup', () => {
    const { guard, calls, getStreamed } = setup();
    guard.push('我先查询一下。');
    guard.push(screenshotLeak);
    guard.push('查询完成。');
    guard.flush();

    expect(getStreamed()).toBe('我先查询一下。查询完成。');
    expect(calls).toHaveLength(1);
  });

  it('should emit plain text with angle brackets unchanged', () => {
    const { guard, calls, getStreamed } = setup();
    guard.push('价格 < 100 且 > 50，');
    guard.push('格式如 <div> 所示。');
    guard.flush();

    expect(getStreamed()).toBe('价格 < 100 且 > 50，格式如 <div> 所示。');
    expect(calls).toHaveLength(0);
  });

  it('should recover complete invoke when stream ends inside envelope', () => {
    const { guard, calls, getStreamed } = setup();
    const truncated = screenshotLeak.replace('</｜DSML｜calls>', '');
    guard.push(truncated);
    guard.flush();

    expect(calls).toHaveLength(1);
    expect(getStreamed()).toBe('');
  });

  it('should drop partial marker at stream end without call', () => {
    const { guard, calls, getStreamed } = setup();
    guard.push('回答<｜DSML｜');
    guard.flush();

    expect(getStreamed()).toBe('回答');
    expect(calls).toHaveLength(0);
  });

  it('should not delay normal streaming noticeably', () => {
    const { guard, getStreamed } = setup();
    const onText = vi.fn();
    const fast = createDSMLStreamGuard({ onText, onToolCall: vi.fn() });
    fast.push('你好');
    expect(onText).toHaveBeenCalledWith('你好');
    guard.push('世界');
    guard.flush();
    expect(getStreamed()).toBe('世界');
  });
});

describe('parseDSMLToolCalls dialect extensions', () => {
  it('should recover self-closed zero-arg invoke inside envelope', () => {
    const text = [
      '<｜DSML｜calls>',
      '<｜DSML｜invoke name="get_weather"/>',
      '</｜DSML｜calls>'
    ].join('\n');
    const { answer, toolCalls } = parseDSMLToolCalls(text);
    expect(answer).toBe('');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.arguments).toBe('{}');
  });

  it('should not let regular invoke swallow a self-closed sibling', () => {
    const text = [
      '<｜DSML｜calls>',
      '<｜DSML｜invoke name="get_time"/>',
      '<｜DSML｜invoke name="get_weather">',
      '<｜DSML｜parameter name="city" string="true">杭州</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜calls>'
    ].join('\n');
    const { toolCalls } = parseDSMLToolCalls(text);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].function.name).toBe('get_time');
    expect(toolCalls[0].function.arguments).toBe('{}');
    expect(JSON.parse(toolCalls[1].function.arguments)).toEqual({ city: '杭州' });
  });

  it('should recover orphan self-closed invoke with prose', () => {
    const { answer, toolCalls } = parseDSMLToolCalls('前<｜DSML｜invoke name="get_weather"/>后');
    expect(toolCalls).toHaveLength(1);
    expect(answer).toBe('前后');
  });

  it('should parse ascii double-bar self-closed', () => {
    const { toolCalls } = parseDSMLToolCalls('<||DSML||invoke name="get_weather"/>');
    expect(toolCalls).toHaveLength(1);
  });

  it('should map direct JSON body to arguments', () => {
    const text = '<｜DSML｜invoke name="get_weather">{"city":"杭州","days":3}</｜DSML｜invoke>';
    const { toolCalls } = parseDSMLToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ city: '杭州', days: 3 });
  });

  it('should unwrap direct JSON name/arguments wrapper by schema', () => {
    const text =
      '<｜DSML｜invoke name="xCbFfFeOx29XYGSh">{"name":"xCbFfFeOx29XYGSh","arguments":{"userChatInput":"hi","directOutput":false}}</｜DSML｜invoke>';
    const { toolCalls } = parseDSMLToolCalls(text, appTools);
    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      userChatInput: 'hi',
      directOutput: false
    });
  });

  it('should degrade invalid JSON body to empty args', () => {
    const text = '<｜DSML｜invoke name="get_weather">{not json}</｜DSML｜invoke>';
    const { toolCalls } = parseDSMLToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.arguments).toBe('{}');
  });

  it('should strip truncated self-closed tail without call', () => {
    const { answer, toolCalls } = parseDSMLToolCalls('回答<｜DSML｜invoke name="x"/');
    expect(toolCalls).toHaveLength(0);
    expect(answer).toBe('回答');
  });

  it('should align streamed text with stripped answer around envelope', () => {
    const text = '前置说明\n' + directCall + '\n后置说明';
    let streamed = '';
    const guard = createDSMLStreamGuard({ onText: (t) => (streamed += t), onToolCall: vi.fn() });
    for (let i = 0; i < text.length; i += 5) guard.push(text.slice(i, i + 5));
    guard.flush();
    expect(streamed).toBe(parseDSMLToolCalls(text).answer);
  });
});

describe('createDSMLStreamGuard self-closed', () => {
  it('should recover self-closed invoke before flush and keep streaming prose', () => {
    let streamed = '';
    const calls: ChatCompletionMessageToolCall[] = [];
    const guard = createDSMLStreamGuard({
      tools: appTools,
      onText: (t) => (streamed += t),
      onToolCall: (c) => calls.push(c)
    });
    const block = '<｜DSML｜invoke name="xCbFfFeOx29XYGSh"/>';
    for (let i = 0; i < block.length; i += 3) guard.push(block.slice(i, i + 3));
    expect(calls).toHaveLength(1);
    guard.push('后续说明');
    expect(streamed).toBe('后续说明');
  });
});

describe('mergeToolCalls', () => {
  const call = (id: string, name: string, args: string): ChatCompletionMessageToolCall => ({
    id,
    type: 'function',
    function: { name, arguments: args }
  });

  it('should keep parallel identical calls in base and only add new fingerprints', () => {
    const base = [call('a', 't', '{}'), call('b', 't', '{}')];
    const extra = [call('c', 't', '{}'), call('d', 'u', '{}')];
    const { merged, added } = mergeToolCalls(base, extra);
    expect(merged).toHaveLength(3);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('d');
    expect(base).toHaveLength(2);
  });

  it('should not mutate base array', () => {
    const base = [call('a', 't', '{}')];
    const { merged } = mergeToolCalls(base, [call('b', 'u', '{}')]);
    expect(base).toHaveLength(1);
    expect(merged).toHaveLength(2);
  });
});
