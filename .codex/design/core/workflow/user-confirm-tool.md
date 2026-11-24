# 内置人工确认工具（user_confirm）

> 状态：已实现并验证（2026-11-24）。适用节点：工具调用（toolCall）、子代理（subAgent）。

## 背景

agent 循环缺少"AI 判断需人工确认时输出问题让用户作答"的能力。既有 userSelect 仅单问题单选且选项画布静态配置；formInput(userInput) 交互具备多字段表单/剥壳/回填/resume 全链路，但 select/multipleSelect 是下拉控件，不符合"平铺 radio/checkbox"的要求。

用户决策：开关默认开；平铺 radio（单选）/checkbox（多选）；两者均支持手动输入自定义答案；一次确认支持多个问题（1-5）。

## 工具契约

- 名称 `user_confirm`（`SubAppIds.confirm`），定义于 `packages/global/core/workflow/node/agent/confirmTools.ts`。
- 参数 zod：`{ questions: [{ question: string.min(1), options?: string[], multiple?: boolean }].min(1).max(5) }`。
- 归一化 `normalizeConfirm`：options trim/去空/去重/上限 8；question 空白或 questions 空 → 返回错误文本**不挂起**。
- 每问合成一个表单字段：options 非空 → `radio`（multiple=false）/`checkbox`（multiple=true）；options 空 → `input` 纯手动。字段 key=`q0..q4`，`required:true`、`allowCustom:true`，valueType string/arrayString。
- 交互类型用 **userInput**（不用 agentPlanAskUserForm：其 query 分支不回填会死循环）。
- 挂起返回 `{ response:'等待用户确认：…', interactive, flowResponse:getConfirmToolWorkflowResponse(...), usages:[] }`；卡片显示名"人工确认"（systemSubInfo 注册）。
- 同轮守卫：runToolCall 闭包 `pendingInteractive`，本轮已有交互时确认返回错误文本不挂起；工具 description 禁止与其他工具并行调用。
- 开关 `NodeInputKeyEnum.useUserConfirm`：toolCall/subAgent 模板 switch 默认 true，运行时 `!== false` 注入工具（存量节点无该键时默认开）。

## 用户回答回流链路

```
浏览器表单提交 ──JSON({q0:…,q1:[…]})──> 新一轮用户消息(query) ──API resume──>
handleInteractiveTool 拦截解析 ──> 替换占位 tool message.content ──> LLM 下一轮(role:'tool')
```

1. 前端 FormInputComponent 按 inputForm key 组装 JSON → `onSendPrompt(JSON.stringify(answers))`；本地 `rewriteHistoriesByInteractiveResponse` 回填展示态；请求只发最后一条 Human 消息。
2. API resume：concatHistories 取 DB 外壳（toolChildrenInteractive）→ entryNodeIds 入口 → dispatchRunTools 收 lastInteractive → 子层 childrenInteractiveParams。
3. `toolCall.ts handleInteractiveTool` 开头反查 memoryRequestMessages 中 toolCallId 对应 assistant.tool_calls：name===user_confirm → `chatValue2RuntimePrompt(query).text` JSON.parse（try/catch→{}）→ 全空返回错误文本不挂起；否则 `formatToolResponse(answers)` 返回，**跳过 initToolNodes/runWorkflow**。
4. `agentCall/index.ts` resume 分支把占位 tool message 的 content 替换为用户答案 JSON → 续跑循环。AI 以"工具返回结果"形式读到回答。
5. 嵌套 subAgent：外层反查命中的是 subAgent nodeId → 走画布路径下传内层壳 → 子层门控命中 → 子层拦截解析 → 子终答作为 subAgent 工具结果回外层。
6. 持久化：saveChat.updateInteractiveChat 按 key 回填 value+submitted（表单置灰回显）；该轮用户消息按 form submit 消费，不新增会话轮次；resume 轮复用挂起轮 usageId 计费。

## 前端平铺控件

- 枚举增量：`FlowNodeInputTypeEnum.radio/checkbox`（FlowNodeInputMap 补条目；画布 RenderList 补 undefined 不渲染）；formRender `InputTypeEnum` + `nodeInputTypeToInputType` 映射。
- `formRender/index.tsx`：radio 复用 LeftRadio（平铺竖排点选）；checkbox 用 CheckboxGroup+Stack 平铺；`allowCustom` 时控件下方 Chakra Input：radio 自定义值直接写字段（value 不在 list 即自定义态）；checkbox Enter append（trim/去重），list 外值以附加 checkbox 行回显。
- 多问题零改动：FormInputComponent 已 inputForm.map 多字段 + 逐字段 required + 按 key 合并提交。
- 回填/剥壳零改动：rewriteHistoriesByInteractiveResponse、updateInteractiveChat、extractDeepestInteractive 通用生效。
- i18n：`use_user_confirm`（人工确认）、`use_user_confirm_desc`、`confirm_custom_placeholder`（zh-CN/en/zh-Hant）。

## v2 卡片 UI（2026-11-24 重做，参考 4.17.4 agent v2 截图）

用户否决聊天内堆叠表单，要求 4.17.4 的**底部悬浮问答卡片**效果。定稿语义：

- 卡片挂载于 ChatBox 输入区（pending 时替换输入框）：`ConfirmCard.tsx`（Interactive 目录）。
- 头部：当前问题标题 + 翻页器 `‹ 1/N ›` + ×；多问逐页作答。
- 选项行：单选=编号圆点+加粗标题+灰色描述（点选即答）；多选=行内 Checkbox 勾选累加；options 支持 `{label, description}`（兼容纯字符串），normalize 按 label 去重/上限 8。
- 底部：自由输入「告诉 FastGPT 你的想法」（回车=当前题自定义答案；多选回车追加）+「跳过」按钮。
- 提交时机：单选点击/自定义回车后若全部已答且当前为末题→自动提交；否则跳下一未答题；多选勾选不自动提交，末题右箭头=完成提交；全答非末题自动跳末题。
- 跳过/×：发送 `{skip:true}` → resume 拦截返回「用户跳过本次确认，请按默认策略继续执行。」不挂起。
- 契约增量：`userInput.params.confirmCard:true` 标记卡片模式；`inputForm[].list[].description` 可选；存量无标记的 userInput 仍走旧表单（formRender radio/checkbox 分支保留作旧记录回显）。
- 回显：提交后卡片消失，气泡内 `ConfirmCardSummary` 逐题「问题：答案」；全空（跳过）显示「跳过」。
- i18n：chat.confirm_card_input_placeholder / confirm_card_skip（三语）。

## 子代理空工具守卫

`dispatch/ai/tool/index.ts`：子代理自身边工具+白名单追加为空时，仅当 `useUserConfirm === false` 才报"子代理没有可用工具"；默认开时裸子代理仍可以仅靠内置确认工具运行（与主节点行为一致）。

## 边界

- 新枚举仅交互表单使用；画布编辑器 InputTypeSelector 显式清单不变，存量节点零影响。
- API 自带 histories 的 resume 失效为既有边界（外壳取自 DB）。
- master/piAgent 不在范围；同轮多交互 last-wins 既有行为，确认自护+description 禁并行。

## TODO

- [x] Phase 1 后端：confirmTools.ts / constants / 枚举 / 模板开关 / type / constants 卡片 / toolCall 注入+挂起+resume 拦截+同轮守卫
- [x] Phase 2 前端：formRender radio/checkbox/allowCustom、RenderList、i18n
- [x] Phase 3 单测：userConfirm.toolCall.test.ts(8)、agentCall.userConfirm.test.ts(2)、subAgent.dispatch 守卫用例更新+新增（14）
- [x] Phase 4 全量：global 1593 通过；app 590/591（仅存量 request.test 失败）；service 仅存量 clearDirFiles 失败（Node24 rmdir）；lint 通过；tsc --noEmit 通过；next build 类型门禁通过（产物阶段 macOS fsevents/nunjucks 存量报错，CI linux 不受影响）。注意：同包并发 vitest 会互删 coverage/.tmp 致崩溃，全量复跑需独占或 --coverage.enabled=false
- [x] Phase 5 E2E：API 7/7（挂起形状 radio/checkbox/allowCustom、主 resume 回流、嵌套 subAgent 挂起/恢复）；浏览器：画布两节点开关默认开、平铺 radio/checkbox+自定义输入（无下拉）、点选提交回流+置灰回显、radio 自定义值+checkbox 回车追加回流回显、纯文本问 input 回流只读回显
- [x] 子代理空工具守卫放行内置确认工具（index.ts + 测试）
- [x] v2 后端：options {label,description}、list.description、confirmCard 标记、skip 语义（单测 +2）
- [x] v2 前端：ConfirmCard 卡片（翻页/点选即答/多选勾选/自定义/跳过）+ ChatBox 挂载 + 摘要回显 + i18n
- [x] v2 验证：API E2E 7/7（confirmCard/description/skip/嵌套）；浏览器卡片全链路（布局对照截图/翻页/点选即答/多选勾选/末题完成/自定义回车/跳过/摘要回显）；global 1593、service 1777/1778、app 590/591（仅存量失败）；tsc 与 next build 类型门禁通过；E2E 环境已清理
- [x] 提交并打 tag：bf33ddd15 / v4.14.31-ch-fix23（2026-11-24，用户指示；branch 与 tag 已 push origin）