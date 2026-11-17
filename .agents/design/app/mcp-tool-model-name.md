# MCP 工具模型名称（modelName）双名制设计

## 背景

模型 API 要求工具名仅 ASCII（`[a-zA-Z0-9_-]`，≤64 字符）且全局唯一。
v4.17.4 运行时用 `pluginId.replace(/[^a-zA-Z0-9_-]/g, '')` 生成模型侧 nodeId，
中文 MCP 工具名清洗后塌缩为同一字符串（`mcp-<工具集ID>`），Agent 调用模型时报
`400 Tool names must be unique`。政企客户需要界面展示中文工具名，模型侧使用可控的 ASCII 名。

## 架构事实（源码核实）

三个名字各走独立链路：

| 名字 | 载体 | 处理 |
|---|---|---|
| 展示名（中文） | `tool.name`、节点 `name`/`intro` | 不变 |
| 模型名 | 运行时 `nodeId` | 本次改造点 |
| 路由名（中文原名） | `toolConfig.mcpTool.toolId` → `MCPClient.toolCall({toolName})` | 不变，与 nodeId 无关 |

`getMCPChildren` 读取工具集已保存版本的 toolList（`...item` 展开），modelName 存进去即自动到达运行时。

## 方案

1. **数据模型**：`McpToolConfigSchema` 增加可选 `modelName`，规则 `^[a-zA-Z0-9_-]{1,35}$`
   （`MCP_TOOL_MODEL_NAME_REGEX`）。上限 35 是因为运行时拼 `mcp-<24位工具集ID>-` 前缀
   （防跨工具集重名）后不超过 64。OpenAPI create/update/getChildren/getTools 复用该 schema 自动继承。
2. **唯一性校验**：`findDuplicateModelName` 纯函数，前端即时提示 + create/update API
   `superRefine` 边界校验共用。
3. **运行时 nodeId**：
   - 单选 MCP 子工具（`formatMcpToolNode`）与整组展开（agent utils、dispatch/utils）：
     配置了 modelName → `getMcpModelNodeId({toolSetId, modelName})`；
     未配置 → `toModelSafeToolId(pluginId)`（清洗 + djb2 稳定哈希后缀，确定性保证 schema 与路由一致）。
   - HTTP 单选子工具同样套用 `toModelSafeToolId` 回退（同类缺陷一并修复，不含 modelName 配置）。
   - 纯 ASCII ID 原样返回，存量系统工具/英文工具零影响。
4. **同步保留**：`mergeToolSetChildDescriptions` 更名 `mergeToolSetChildConfigs`，
   MCP 分支按 name 回填已保存 modelName（远端模板不携带该字段）；
   前端「解析」onSuccess 同样按 name 合并，避免重新解析丢失配置。
5. **前端**：MCPTools 工具详情弹窗增加「模型名称」输入框（mono 字体），
   留空 = 未配置（运行时自动生成）；非空校验 ASCII 规则 + 工具集内唯一，错误时禁用确认。
   工具列表项展示已配置的 modelName 标签。i18n：zh-CN/en/zh-Hant/ko-KR。

## 兼容性

- 存量数据无 modelName：行为 = 自动哈希回退，中文工具 400 缺陷直接修复，无需迁移。
- 已配置 modelName：模型侧语义化 ASCII 名；展示与远端调用仍用中文原名。
- 执行分发链路（runTool / toolCall）零改动。

## 验证

- `packages/global/test/core/app/tool/utils.test.ts`、`.../mcpTool/utils.test.ts`：70 用例通过
  （哈希唯一性/确定性/ASCII、schema 校验、nodeId 长度与跨工具集唯一、查重、合并保留）。
- tsc：global/service/app 三包中本次改动文件零错误（包内其余错误为本地 node_modules 链接不全的预存环境问题）。

## TODO

- [ ] 用户验收后跑全量测试（仓库约定）。
- [ ] 构建自定义镜像并在内网部署验证：工具集配置 7 个 ASCII 名 → Agent 真实调用信访 MCP 工具端到端。
- [ ] 视情况向上游提 PR（影响所有 CJK MCP 用户）。

## fix2：单选路径 ID 重算覆盖缺陷 + AI 生成模型名

### 缺陷（fix1 镜像实测仍报 400 的根因）

`getAgentRuntimeTools` 的单工具分支（非 toolSet）在 `formatMcpToolNode` 之后，
又用 `getAgentRuntimeToolId({ pluginId })` 对**原始 pluginId**（`<工具集ID>/<中文名>`，
`splitCombineToolId` 已剥掉 `mcp-` 前缀）重新裸清洗，得到纯工具集 ID，
覆盖了 format 阶段算好的唯一 nodeId → 7 个中文工具模型侧全部塌缩为 `t<工具集ID>`。
fix1 只改了 format 阶段，未改这处重算，故未生效。

### 修复

1. `getAgentRuntimeToolId` 非 source 隔离分支改用 `toModelSafeToolId`（纯 ASCII 原样返回）。
2. 单工具分支改传 `toolNode.nodeId`（已含 modelName 优先 + 哈希唯一化）而非原始 pluginId；
   source 隔离（团队插件/调试）分支仍走 `hashStr(source:rawId)` 保持隔离语义。
3. `adapter/prompt.ts` 工具引用候选 ID 增加 `toModelSafeToolId(pluginId)`，
   保证提示词 `{{@工具ID@}}` 能解析到新格式模型名。
4. 回归测试：中文工具单选/整组挂载模型名唯一、modelName 优先、路由仍走中文 toolId；
   同步更新 7 处断言旧裸清洗行为的存量用例（service 52 用例 + global 70 + prompt 1 全过）。

### AI 生成模型名（用户反馈手动填写太多）

- 新 API `POST /api/core/app/mcpTools/generateModelName`：
  body `{ tools: [{name, description}], existingNames? }` → `{ modelNames }`（与 tools 等长）。
  鉴权 authCert；模型用团队默认 LLM（`getTeamModelHandle().getDefaultModelData('llm')` + 授权过滤，
  同 createQuestionGuide 模式）；计费 source=mcp。
- 服务层 `packages/service/core/ai/functions/generateMcpModelNames.ts`：
  system prompt 约束 snake_case/字母开头/≤35/避开 existingNames/只输出 JSON 数组；
  json5 解析 + 逐项 sanitize（小写、非法字符转下划线、限长、数字开头补 t、占用追加 _2/_3）；
  解析失败回退序号占位名，保证返回值始终合法唯一等长。
- 前端：工具列表头「一键 AI 生成模型名」批量补齐未配置项（已配置不动）；
  详情弹窗模型名称输入框旁「AI 生成」单个重生成。i18n 四语言新增 3 键。