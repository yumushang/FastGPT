# 技能节点（Skill Node）设计文档

## 背景

大量问答应用入口过多，用户使用麻烦。目标：把各应用的提示词拆成 skills，由一个统一入口工作流承接问答——模型先看到各技能的名称/触发描述，执行指定工作时按需读取相关技能正文再执行（渐进式披露）。

约束（用户决策）：
- 不引入额外存储（不用 S3 技能库、不建新 Mongo 集合），技能正文直接存在工作流节点输入里，随应用 modules 保存。
- 不需要沙箱/虚拟机。
- v1 仅挂载到「工具调用」（toolCall）节点；agent 节点工具来自弹窗选应用、不读画布连线，扩展成本大，后续再议。
- 技能节点为单正文提示词形态，不做多引用文件。

## 方案

新增 `FlowNodeTypeEnum.skill` 工具类节点（`isTool: true`）：

| 部分 | 承载 | 说明 |
|---|---|---|
| 技能名 | 节点 name | 画布可改名 |
| 触发描述 | 节点 intro | 连上工具线后 NodeCard 铅笔可编辑；toolCall 生成工具描述用 `name: toolDescription||intro` |
| 指令正文 | input `system_textareaInput`（textarea，required） | 支持 {{变量}}；**不带 toolDescription**（否则会成为让模型填写的参数） |
| 输出 | `text`（static/string） | 可接普通下游节点 |

运行时（toolCall 现有机制，零改动）：
1. `filterToolNodeIdByEdges` 从 `targetHandle=selectedTools` 的边收集技能节点。
2. 空正文节点被 `getToolConfigStatus` 判 `waitingForConfig`，自动移出工具列表（填好才生效）。
3. 工具清单 = 各技能 `名称: 触发描述`；零参数工具合法，模型空 arguments 经 `parseJsonArgs` 容错、`updateToolInputValue` 保留节点原值。
4. 模型选调技能 → 子图执行 `dispatchSkill` → 返回 `toolResponses`（指令包裹的正文）→ 进入下一轮 messages → 模型按指令执行（可继续调知识库/HTTP 等工具）。

dispatch 返回：
```
toolResponses = "已加载技能「{节点名}」。请严格按照以下技能指令处理当前任务：\n\n{正文}"
data.text     = 正文（变量替换后）
nodeResponse.textOutput = 正文（调试面板）
```

## 使用方式

1. 新建工作流应用，添加「工具调用」节点，配置模型与系统提示词（统一助手路由说明）。
2. 从节点面板添加多个「技能」节点，把原应用提示词粘贴进正文，节点改名为技能名。
3. 从工具调用节点的工具手柄拖线到各技能节点。
4. 点击技能节点简介铅笔，填写触发条件（如"当用户询问报销流程时使用"）。
5. 工具调用节点输出接「指定回复」等下游。对话时模型按问题自动选择技能读取并执行。

## 边界与说明

- 纯增量：不动 agent/toolCall 运行时、不动现有沙箱 skills（SHOW_SKILL）、无 env/存储依赖；旧应用零影响。
- 跨应用复用：复制粘贴技能节点（无共享库）。
- 长正文：上下文吃紧时 `compressToolResponse` 可能 LLM 压缩工具响应，建议技能正文精简；v1 不截断。
- 连续 >5 轮纯工具调用强制回答（现有循环保护）；技能"读取→执行"通常 2-3 轮。
- 技能调用展示为标准工具卡片；专属技能卡片为可选后续增强。
- piAgent 引擎与简易配置应用不涉及（无画布）。

## 改动清单

- `packages/global/core/workflow/node/constant.ts`：枚举 `skill`
- `packages/global/core/workflow/template/system/skill.ts`：节点模板（新建）
- `packages/global/core/workflow/template/constants.ts`：systemNodes 注册
- `packages/service/core/workflow/dispatch/tools/skill.ts`：dispatch（新建）
- `packages/service/core/workflow/dispatch/constants.ts`：callbackMap / FlowNodeTypeResTextMap
- `projects/app/src/.../WorkflowComponents/Flow/index.tsx`：nodeTypes → NodeSimple
- `packages/web/i18n/{zh-CN,zh-Hant,en}/workflow.json`：文案
- `packages/service/test/core/workflow/dispatch/tools/skill.test.ts`：单测（新建）

## TODO

- [x] 设计文档
- [x] 枚举 + 模板 + 注册
- [x] dispatch + callbackMap/ResTextMap
- [x] 前端 nodeTypes 映射
- [x] i18n 三语
- [x] 单元测试（变量替换/指令包裹/toolResponses/空正文）
- [x] 单元测试（变量替换/指令包裹/toolResponses/空正文/工具列表显隐，8/8 通过）
- [x] 局部测试（dispatch 回归 436/436）→ 全量测试 → lint/typecheck
  - global 1583/1583、app 590/591、service 1705 通过/26 跳过；typecheck、eslint 通过
  - 2 个失败为既有环境问题，与本次无关：service `clearDirFiles`（Node 24 移除 rmdir recursive 支持）、app `request.test.ts` team error（zustand localStorage mock）
  - 根 `pnpm test` 脚本引用不存在的 @fastgpt/admin 包（fork 裁剪），全量需用 turbo --filter app/global/service
- [x] 浏览器 E2E（本地隔离栈：Docker mongo/redis/pgvector + mock LLM/插件服务，端口 3001/3002）
  - 画布：技能节点出现在节点面板、NodeSimple 渲染正文/输出、工具连线建立 ✓
  - 运行时（chatTest API 全链路）：模型选调技能（函数名=节点 id）→ dispatchSkill 返回包裹正文 → 二轮上下文含正文 → 指定回复输出 ✓
  - 空正文技能自动移出工具列表（tools=2 而非 3）✓
  - 路由：报销问题→报销助手（ALPHA 令牌），请假问题→请假助手（BETA 令牌）✓
  - {{变量}} 替换：声明变量后正文内 {{username}} → 实际值 ✓
  - 全程无沙箱事件/容器 ✓
  - 注：编辑器常驻预览面板不注入 nodes（既有行为），需点顶部「运行」打开调试弹窗；API 直调时 nodes.inputs 需补 label、chatConfig.variables 需合并 userGuide 变量声明