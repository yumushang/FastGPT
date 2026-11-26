# 直出钩子（directOutput）重复输出修复（fix24）

> 状态：已实现并验证（2026-11-26）。计划：rugged-mountain-moorhen.md（用户批准方案 B）。

## 现象与根因

toolCall 挂子应用/插件工具且直出命中时，对话气泡全文输出两遍；完整响应详情一份。

同一段文本两次进入父级 SSE 文本气泡：
1. 子应用流式透传：`dispatch/child/runApp.ts:90,150-159` 透传父 `workflowStreamResponse`（仅 `system_forbid_stream` 切断）；子 answerNode `dispatch/tools/answer.ts:25-30` 推 `fastAnswer`。
2. 父级直出补推：`dispatch/ai/tool/index.ts:302-309` `if (terminalResponse)` 再推 `fastAnswer`（91d1ba027 引入；639ecd5f6/f6aa94499 使 appModule 可命中）。

前端 `ChatBox/index.tsx:459-508` 将 answer/fastAnswer 累加进同一 `value.text.content` → 单气泡两遍。详情走 `flowNodeResponse→responseData` 隔离 → 一份。

## 修复（方案 B：直出命中子运行静默）

唯一文件 `packages/service/core/workflow/dispatch/ai/tool/toolCall.ts` 两处：
- canvas 分支：`initToolNodes` 后求值 `directOutput = readDirectOutput(node, startParams)`；子 `runWorkflow` props 条件 spread `...(directOutput ? { stream:false, workflowStreamResponse:undefined } : {})`（不 mutate workflowProps）；`isTerminal = directOutput && !workflowInteractiveResponse`。
- resume 分支：`directOutput = entryNodeIds.some(id => readDirectOutput(...))`；同 spread；isTerminal 复用。

静默经 props 透传任意深度；唯一输出=持活 SSE 层的 index.ts:302 补推；嵌套内层补推 no-op。非直出 props 逐字节不变。

## 影响面（复核结论）

零影响：非直出路径、内置工具（plan/sandbox/user_confirm）、父 LLM body.stream、一轮多工具、resume 未还原参数、交互卡片下发（interactive 仅根级推）、详情面板、usage/assistantResponses、既有单测断言。
预期变化（仅直出）：子树静默、文本完成时一次输出；直出工具内部 toolCall/toolResponse 卡片不进根气泡（明细仍在面板）；子 LLM 改非流式（同 system_forbid_stream 既有模式）；runApp 自动 `\n` 不再推。
极端组合 system_forbid_stream + subAgent(isResponseAnswerText=false) 直出：index.ts:302 不受 isResponseAnswerText 约束 → 仍唯一输出。

## 验证

- 单测：subAgent.toolCall.test.ts +7（静默/透传/覆盖/挂起/resume×2）、subAgent.dispatch.test.ts fastAnswer 计数 1/0；局部 72/72。
- 全量：global 1593；service 1839/1840（仅存量 clearDirFiles）；app 590/591（仅存量 request.test）；lint、tsc 通过。
- E2E 8/8（隔离栈+mock）：S1 节点直出单份无总结；S2 非直出子流式单份+总结（总结引用子文本属正常）；S3 LLM 传参 true 覆盖节点 false 单份；S4 嵌套 root→subAgent(直出)→appModule 单份（mock 日志 SUB stream=false）；S5 子应用挂 user_confirm 卡片下发/resume 单份（CHILD stream=false）。
- 浏览器截图核对**未完成**：MCP 浏览器实例本次会话水合持续损坏（__next 空、重启 dev 无效），属环境问题；SSE 层断言已精确覆盖气泡文本流（answer+fastAnswer 合计份数）。
- 附带发现（非本修复范围）：子应用图若为 toolCall→answerNode(引用 toolCall.answerText)，runApp 的 answerText=join(全部 assistantResponses) 会把中间答复与回显拼接成双份——既有语义，建图应避免回显环。

## TODO

- [x] 修复两处 + 单测 + 全量门禁 + E2E 8/8
- [x] 设计文档归档
- [x] 提交：1a3937f9c 已 push origin/ch-v4.14.31；tag v4.14.31-ch-fix25 指向 1a3937f9c 已 push（fix24 被并行任务占用）