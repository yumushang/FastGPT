# 问题：自部署模型 finish_reason=tool_calls 但工具未执行、对话静默结束

日期：2026-11-24
分支：ch-v4.14.31

## 现象

客户自部署 DeepSeek v4.1 flash（OpenAI 兼容、stream:true、推理模型，请求带 `tools`/`tool_choice:auto`/`parallel_tool_calls:true`）。某轮模型返回 `finish_reason:"tool_calls"` 且有 reasoningText，但 FastGPT 不执行工具、无回答、无报错，对话静默结束。前端仅显示"思考过程"。LLM 请求详情响应仅 `{reasoningText, finish_reason:"tool_calls", usage}`，无 `toolCalls` 字段（记录为条件展开，空数组不落库，见 `packages/service/core/ai/llm/request.ts` saveLLMRequestRecord）。

## 根因链

1. 流式 toolChoice 解析状态机缺陷（`packages/service/core/ai/llm/request.ts` createStreamResponse，旧 440-522 行）：
   - 非空 name 分片整体覆盖 `callingTool`（旧 475-479），name 被 tokenizer 分片时永远拼不出全名；注释声称的续接分支（旧 480-484）是死代码。
   - 严格白名单 `tools.find(name 完全相等)`（旧 487）才注册；不匹配静默丢弃且 `callingTool` 不清空，后续 arguments 分片全吞进孤儿对象，零日志。
   - `callingTool` 跨 index 共享单变量，parallel_tool_calls 交错分片互相污染。
   - 只读 `delta.tool_calls`，不兼容整包 `message.tool_calls` 与旧版 `function_call`。
2. 空响应兜底被绕过（request.ts 315-321）：`isNotResponse` 要求 `!reasoningText` 且 `finish_reason==='stop'||!finish_reason`，推理模型 + tool_calls 两条件同时不满足 → 无 responseEmptyTip。
3. 分发层只看数组长度（`packages/service/core/ai/llm/agentCall/index.ts:421`）：`toolCalls.length===0 → break`，finish_reason 从不参与决策。新旧两条 Agent 链路（`dispatch/ai/agent/index.ts:611-633`、`dispatch/ai/tool/index.ts:296-373`）answerText 过滤 text.content 后为 ''，按成功返回 → 前端只剩思考过程。
4. 下游对未知工具名有优雅回喂（`agent/master/call.ts:518-524` `Can't find the tool ...`；`tool/toolCall.ts:432` `Call tool not found`），故解析层放行未匹配名不会崩溃。

## 修复方案（已实施）

1. 解析层重写（request.ts createStreamResponse toolChoice 分支）：按 index 独立可变累积器；name 追加分片；累积 name 命中白名单即提交并 onToolCall；arguments 追加并 onToolParam；流末未提交且有 name 的累积器一律提交（未命中白名单先 logger.warn 放行，交分发层回喂自纠）；兼容 `message.tool_calls` 整包与 `delta/message.function_call`；id 取首个非空、缺失 getNanoid 兜底。非流式 createCompleteResponse 补 `message.function_call` 回退。
2. 矛盾态安全网（agentCall/index.ts，responseEmptyTip 检查后）：`finish_reason==='tool_calls'||'function_call'` 且 toolCalls 空且无 answer 且未 abort → logger.warn + `Promise.reject(i18nT('chat:LLM_tool_call_response_empty'))`，两条链路转可见节点错误。**不重试**（用户决策）。
3. 诊断：未匹配名 warn 带原始片段（arguments 截断 500）；矛盾态 warn 带 requestId/model；记录响应增加布尔标记 `toolCallParseEmpty`（原始片段只进日志不进 Mongo）。
4. i18n：`packages/web/i18n/{zh-CN,en,zh-Hant}/chat.json` 新增 `LLM_tool_call_response_empty`（zh-CN 必加，类型推导依赖）。

行为决策（用户确认）：矛盾态仅可见报错不重试；未匹配工具名放行+模型自纠。

## 影响面

- 新版 Agent 与旧版 toolCall/subAgent 均经 runAgentCall，安全网同时覆盖。
- prompt 模式、无工具分支、isNotResponse 逻辑未动。
- 幻觉名从"静默丢弃"变"回喂自纠"，可能多 1 轮 token；受 maxRunAgentTimes 与连续工具 >5 轮 tool_choice:none 收敛。

## 验证

- 局部 vitest：`packages/service/test/core/ai/llm/request.test.ts`（新增 name 分片/args 先行/parallel 交错/整包 message/function_call/未匹配放行/abort/非流式回退 8 用例）、新建 `agentCall.emptyToolCall.test.ts`（矛盾 reject、有 answer 不 reject、正常轮不变）。
- 回归：agentCall.controlTool / agentCall.userConfirm / llm/toolCall 测试。
- 类型门禁：projects/app `npx tsc --noEmit`。
- 全量：`npx turbo run test --filter=@fastgpt/app --filter=@fastgpt/global --filter=@fastgpt/service`（根 pnpm test 因裁剪 admin 包损坏）。
- E2E（可选）：mock OpenAI 网关 SSE 复现分片 name（无单 chunk 全名），修复前静默结束、修复后工具执行；矛盾态网关 → 可见报错；未匹配名网关 → 回喂自纠。

## DSML 文本泄漏兼容（2026-11-26 追加）

现象：第三方中转网关未配 tool parser，DeepSeek flash 把工具调用以 DSML 文本漏进 content（截图方言：单全角竖线 + calls 包络 + arguments/name 包装参数），FastGPT 当普通回答展示、不执行工具。与上文结构化分片丢失同大类、不同机制。

实现：`packages/service/core/ai/llm/dsmlCall.ts` — parseDSMLToolCalls（方言矩阵：单/双竖线、全/半角、calls/function_calls/tool_calls/toolcalls 包络、孤儿 invoke、零参自闭合、直连 JSON body、截断半截标记；{name,arguments} 包装按工具 schema 解包）+ createDSMLStreamGuard（text/envelope/invoke 三态暂扣、完整块即时回收、newline 归一化）。request.ts toolChoice 分支挂载：流式守卫 push/flush、独立 dsmlToolCalls 数组、流末全文重解析指纹去重合并（mergeToolCalls，防双份并兜底守卫漏块）；非流式无条件剥离+拷贝合并（不改写 message.tool_calls 原数组）；(dsmlRecovered||added) 控制 stop→tool_calls 升级，纯结构化轮保持 stop。

审查缺陷与修复：D1 混轮 push/index 共用数组覆盖→数组分离；D2 守卫漏块流末只剥文本丢调用→重解析去重合并；D4 非流式 push 副作用→拷贝合并；D3 自闭合/直连 JSON 方言→SELF_CLOSED 正则先跑+buildToolCall 直连分支+守卫自闭合头即时回收；D5 包络前后 newline 全文/守卫不对称→正则补 \n?；D24 非流式孤儿标记残留→无条件剥离。

影响面：改动限 toolChoice 分支；非 DSML 流量零差异（无标记恒等早退、空合并、正则需标记前缀）；残留风险为跨源指纹去重对同名同参双发误并/键序不一致漏配（不劣于现状，记录备查）。

验证：dsmlCall 31 例 + request 45 例 + 邻接回归共 140 绿；tsc --noEmit 通过；全量 turbo 仅存量基线失败（clearDirFiles/team error）。待生产用原中转渠道复测截图场景。