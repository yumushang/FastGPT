import { describe, it, expect } from 'vitest';
import { dispatchSkill } from '@fastgpt/service/core/workflow/dispatch/tools/skill';
import { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { SkillNode } from '@fastgpt/global/core/workflow/template/system/skill';
import { getToolConfigStatus } from '@fastgpt/global/core/app/formEdit/utils';

const buildProps = ({
  text,
  name = '报销助手',
  variables = {}
}: {
  text: string;
  name?: string;
  variables?: Record<string, any>;
}) =>
  ({
    node: { nodeId: 'skillNode1', name },
    variableState: { toRuntimeRecord: () => variables },
    params: { [NodeInputKeyEnum.textareaInput]: text }
  }) as any;

describe('dispatchSkill', () => {
  it('returns framed instructions as toolResponses and raw content as output', () => {
    const content = '你是报销助手，回答报销相关问题。';
    const res = dispatchSkill(buildProps({ text: content, name: '报销助手' }));

    const toolResponse = res[DispatchNodeResponseKeyEnum.toolResponses];
    expect(typeof toolResponse).toBe('string');
    expect(toolResponse).toContain('报销助手');
    expect(toolResponse).toContain(content);
    expect(toolResponse).toContain('请严格按照以下技能指令处理当前任务');

    expect(res.data?.[NodeOutputKeyEnum.text]).toBe(content);
    expect(res[DispatchNodeResponseKeyEnum.nodeResponse]).toEqual({ textOutput: content });
  });

  it('replaces variables in content', () => {
    const res = dispatchSkill(
      buildProps({
        text: '当前用户：{{username}}，请按规范回答。',
        variables: { username: '张三' }
      })
    );

    expect(res.data?.[NodeOutputKeyEnum.text]).toBe('当前用户：张三，请按规范回答。');
    expect(res[DispatchNodeResponseKeyEnum.toolResponses]).toContain('张三');
  });

  it('returns friendly error when content is empty', () => {
    const res = dispatchSkill(buildProps({ text: '', name: '空技能' }));

    expect(res[DispatchNodeResponseKeyEnum.toolResponses]).toContain('空技能');
    expect(res[DispatchNodeResponseKeyEnum.toolResponses]).toContain('为空');
    expect(res.data?.[NodeOutputKeyEnum.text]).toBe('');
  });

  it('treats whitespace-only content as empty', () => {
    const res = dispatchSkill(buildProps({ text: '   \n  ' }));

    expect(res[DispatchNodeResponseKeyEnum.toolResponses]).toContain('为空');
  });

  it('keeps multiline markdown content intact', () => {
    const content = '# 角色\n\n- 规则一\n- 规则二\n\n```json\n{"a":1}\n```';
    const res = dispatchSkill(buildProps({ text: content }));

    expect(res.data?.[NodeOutputKeyEnum.text]).toBe(content);
    expect(res[DispatchNodeResponseKeyEnum.toolResponses]).toContain(content);
  });
});

describe('skill node tool integration', () => {
  it('is a connectable tool with no LLM-filled parameters', () => {
    expect(SkillNode.isTool).toBe(true);
    expect(SkillNode.inputs.every((input) => !input.toolDescription)).toBe(true);
  });

  it('is filtered out of the tool list while content is empty', () => {
    const inputs = SkillNode.inputs.map((input) => ({ ...input, value: '' }));
    expect(getToolConfigStatus({ tool: { inputs } }).status).toBe('waitingForConfig');
  });

  it('becomes a valid tool once content is filled', () => {
    const inputs = SkillNode.inputs.map((input) => ({ ...input, value: '技能指令内容' }));
    expect(getToolConfigStatus({ tool: { inputs } }).status).toBe('configured');
  });
});
