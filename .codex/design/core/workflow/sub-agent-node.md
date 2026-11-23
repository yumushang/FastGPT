# 子代理节点（subAgent）设计文档

## 背景

统一入口 toolCall 挂载工具过多（几十上百），LLM 请求工具定义膨胀、选择准确率下降（根因之一：tools token 不计入上下文守卫，本轮不修）。采用分层委派：主代理分发 → 子代理自主执行 → 主代理汇总；极个别成品工作流直出。

主模型为开源 DeepSeek v4 flash（弱-中级），设计以"仅传任务 + 静态人设接管"为常态。

## 核心语义

### 工具集 = 自身边工具 + 白名单追加
- 子代理可挂自己的工具边（域内基线，静态可靠）。
- 主节点调用时传 `toolWhitelist`（名称数组），从主节点工具池按名追加跨域工具（id 精确优先，名称大小写不敏感，重名全给）。
- **空 whitelist = 仅自身边工具**（弱主模型兜底闭合）；零命中不硬错（misses 提示并入 system）；自身边与追加均空才报错列可用名称。
- 主节点 `toolPoolMode` 开关（默认关）：主 LLM tools 仅子代理类工具，隐藏池以紧凑目录（名称+id+简介截断80）注入 system prompt；无子代理连接时退化关闭。
- **可见性开关 `visibleToMain`**（工具节点输入，默认关，技能/应用节点模板自带）：poolMode 下开启的工具保留在主 LLM 工具列表，可被直调——成品工具直调通道（配合 directOutput 默认 true 实现"主节点直调报告工具、原文直出、无总结轮"）。修复背景：原 poolMode 隐藏一切非子代理工具，导致主节点无法直调成品应用工具、被迫委派子代理再二次总结。
- 池逐层透传：`parentToolNodes`=调用方全池（childToolPool），孙代理继承同一池，白名单单调收窄。

### 参数由主节点掌控
- `systemPrompt`/`userChatInput`/`toolWhitelist`/`directOutput` 均带 toolDescription → 进工具 JSON Schema，主模型按调用填值（initToolNodes/updateToolInputValue 覆写）。
- **静态默认人设是可靠基线**：域角色/工具使用策略/边界/输出契约。动态覆写是每次调用特化（加分项）。
- `inheritCallerModel`（默认 true）：子代理跟随调用方模型（画布自动填 model，空值继承不生效，必须开关）；关闭用本节点模型。
- `history` 默认 0：独立上下文，任务须自包含。
- `isResponseAnswerText` 默认 false：内层 answer/toolCall/toolResponse SSE 静默；外层发委派 toolCall（名+参数）与 toolResponse（终答）；递归明细经 toolDetail 上浮存库。

### 直接输出钩子（按调用声明）
- `directOutput` 是工具参数（subAgent 与 appModule 模板均有，节点默认值可预置）：
  - false/缺省（默认）：终答回主循环整合。
  - true：终答原样提升为最终回复（answerText/assistantResponses/fastAnswer），循环立即结束，无总结轮。
- **调用时读取**：handleToolResponse 在 initToolNodes 之后读覆写值（readDirectOutput：参数 > 节点默认 > false），不能用循环前快照。
- 级联：子内成品工具 true → 子循环终止提升；主对子 true → 直达用户。
- 边界：区别于 stopTool（仅停循环）；interactive 终答前不提升；resume 还原 startParams 保证钩子不丢；同轮多 true 最后一个生效；Plan 剩余步骤不再执行。

### Agent Loop（双层自主循环）
- 子代理：runToolCall→runAgentCall（≤50 轮）自主"思考→调工具→观察"，终答经 toolResponses 回主。
- 主代理：委派是其工具之一；收到答案后继续——再委派/换域/整合。同一子代理可多次委派（参数覆写、独立上下文）。
- 单向委派；子可以终答返回"需补充信息"，主下轮补充再委派。
- 守卫：每层 50 轮、连续>5 纯工具轮强制回答（Plan 控制轮不计）、stopTool 只停本层、深度>20 显式错误、全局 500 节点预算。
- Plan 正交（498a336aa）：控制工具在 runToolCall 内注入，与池/白名单过滤无关；subAgent 模板 useAgentPlan 开关免费继承。

## 组织建议

- 域子代理 3-8 个（财务/人事/IT…，各配扎实静态人设）+ 1 通用兜底。
- 池工具"域:名称"约定命名，目录天然分组。
- 成品工作流（appModule）预置 directOutput 默认 true，减少弱模型决策。

## 人设五层作用

1. 工具使用策略（先查知识库再答、引用条款）——子代理 loop 可靠性关键。
2. 降级锚点——弱主模型仅传任务时静态人设接管（Tier 2 常态）。
3. 边界治理（域外拒答、敏感数据规则）。
4. 输出契约（主代理整合可预期）。
5. 动态覆写=每次调用特化（强模型加分项）。

## 三级降级阶梯

```
Tier 1 全动态：主模型生成 systemPrompt + whitelist + task（强模型）
Tier 2 仅任务：主模型只传 task → 静态人设 + 自身边工具接管（DeepSeek flash 常态）
Tier 3 不委派：关 poolMode → 主节点直调池工具（现状兜底）
```

## 演进路线

- L0 技能节点（已完成）：提示词作为工具按需读取。
- L1 Plan 引擎（498a336aa）：set_plan/update_plan + 步骤状态机。
- L2 子代理（本次）：池继承 + 白名单 + 动态参数 + 输出钩子。
- L3 未来：计划步骤自动委派（步骤附 assignee/whitelist，状态机路由）、分层目录、tools token 计数根因修复、跨轮子任务记忆。

## 实现落点

- 枚举/键：`FlowNodeTypeEnum.subAgent`；`toolPoolMode/toolWhitelist/inheritCallerModel/directOutput`。
- 透传：ChatDispatchProps.parentToolNodes/parentToolModel；DispatchToolModuleProps.childToolPool。
- 纯函数：`dispatch/ai/tool/subAgentUtils.ts`（normalizeWhitelist/matchPoolByWhitelist/mergeToolNodes/buildToolPoolCatalog/splitPoolForLLM/restoreToolStartParams/readDirectOutput）。
- dispatchRunTools：subAgent 分支（边推导+白名单合并）、模型继承、catalog 注入、toolResponses 返回（修嵌套收 none）、terminalResponse 提升+fastAnswer。
- runToolCall：parentToolNodes/parentToolModel 透传（含 resume 路径）、handleToolResponse 调用时读 directOutput、handleInteractiveTool 还原 startParams（修既有 resume 丢参）。
- dispatch/index：入口重置豁免 subAgent；深度超限显式错误。
- 模板：subAgent.ts（新建）、toolCall.ts（toolPoolMode）、runApp.ts（directOutput，模板合并补既有节点）。
- 画布：NodeSubAgent（NodeTool 范式+工具 Divider）、NodeCard ToolSourceHandle 加 subAgent、hasToolNode 加 subAgent、校验（hasEdge 过滤修正 + subAgent 未挂载标红）。

## 边界与风险

- 既有应用零影响：开关默认 false；toolResponses 新增仅改善插件收 none；resume 还原有 entryNodeIds 守卫、找不到退化现状。
- 目录仍占 token（100 工具≈4k）；根因本轮不修。
- 弱模型误填 directOutput=true 会跳过汇总——指引+默认 false+节点预置约束。
- 子代理 Plan 卡片 v1 不在主聊天渲染（明细在调试面板）。
- 主模型需 toolChoice=true（否则 prompt 模式工具进 system 更膨胀）。

## TODO

- [x] 运行时骨架（枚举/键/类型/纯函数/dispatchRunTools/runToolCall/agentCall/入口豁免/深度错误）
- [x] 模板与画布（subAgent/toolPoolMode/runApp 钩子/注册/组件/门控/校验/i18n）
- [x] 单测 29/29（utils/dispatch/toolCall 三层）
- [x] 全量测试 + lint + typecheck（global 1588/1588、app 590/591、service 1754/1755；2 个失败为既有环境问题：Node24 rmdir recursive、zustand localStorage mock；lint 0 错误、typecheck 通过）
- [x] E2E 12/12（本地隔离栈 + mock LLM）：poolMode 主 tools=2 隐藏池、白名单追加 own2+pool1=3、弱主仅任务→自身边 1 工具、直出钩子主仅 1 轮+子终答 fastAnswer 原样直达、无总结；画布：子代理节点渲染（跟随模型/计划/history=0/工具参数表）、工具池模式开关、9 条连线、面板入口
- [x] visibleToMain 可见性开关（poolMode 成品直调通道）：单测 49/49；技能库中心维护形态暂缓（用户决策）
- 注：入口豁免与深度逻辑在 runWorkflow 内部，由 E2E 覆盖（非单测）
- E2E 环境要点：API 登录需 preLogin code + sha256 密码 + fastgpt_token cookie；新 Mongo 需插 team_subscriptions 默认 standard 文档；内置浏览器旧页面水合损坏时关闭开新页即恢复