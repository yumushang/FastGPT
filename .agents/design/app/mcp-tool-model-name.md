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