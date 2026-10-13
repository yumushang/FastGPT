# AI 配置节点 - Body 额外字段

## 需求分析

### 背景

模型配置(账号 - 模型提供商)中已有「Body 额外字段」(`defaultConfig`),发起对话请求时会合并进请求 Body。目前工作流的「AI 配置」弹窗(AIChatSettingsModal)不支持该能力,用户无法针对单个工作流节点传递模型自定义参数(例如 `reasoning_effort`、`thinking` 等厂商私有字段)。

### 需求

1. 在工作流「AI 配置」弹窗中增加「Body 额外字段」参数,UI 与模型配置中的 JsonEditor 一致。
2. 该参数直接传递到模型层(`createLLMResponse` → `llmCompletionsBodyFormat`)。
3. 与模型配置中的 `defaultConfig` 合并,**键冲突时以工作流节点中的配置为准**。

### 范围

- 本期仅接入 **AI 对话节点(chatNode)** 全链路;Agent 节点、工具调用节点共用同一弹窗,但它们的节点模板不新增该 input,弹窗通过「节点是否包含该 input」自动隐藏此字段,后续版本再接入。
- 简易应用(Simple App)的 AI 设置同步读写该字段(chatNode 模板)。

## 开发设计

### 数据流

```
AI 配置弹窗 (JsonEditor, 字符串)
  → 节点 hidden input: aiChatExtraBody (valueType: string, JSON 文本)
  → dispatch/ai/chat.ts 解构 params.aiChatExtraBody
  → createLLMResponse body.extraBody
  → llmCompletionsBodyFormat: json5 解析
  → requestBody = { ...requestBody, ...modelData.defaultConfig, ...extraBody }  // 工作流优先
  → ai.chat.completions.create
```

### 契约(命名固定,各方按此实现)

| 项 | 值 |
|---|---|
| NodeInputKeyEnum | `aiChatExtraBody = 'aiChatExtraBody'`(constants.ts 中紧跟 `aiChatJsonSchema` 之后) |
| 节点 input | hidden,`valueType: WorkflowIOValueTypeEnum.string`,存 JSON 文本(与 `aiChatJsonSchema` 同模式) |
| SettingAIDataType | `[NodeInputKeyEnum.aiChatExtraBody]?: string;` |
| AIChatNodeProps(runtime/type.ts) | `[NodeInputKeyEnum.aiChatExtraBody]?: string;` |
| LLM body 自定义字段 | `extraBody?: Record<string, any> \| string;`(LLMRequestBodyType) |
| 弹窗 prop | `showExtraBody?: boolean`,默认 `true` |
| i18n(app.json,三语 zh-CN/en/ja) | `extra_body` = "Body 额外字段";`extra_body_tip` = 合并说明 + 示例 |

### 各层改动

1. **packages/global**
   - `core/workflow/constants.ts`: `NodeInputKeyEnum` 增加 `aiChatExtraBody`。
   - `core/app/type.ts`: `SettingAIDataType` 增加该可选字段。
   - `core/workflow/runtime/type.ts`: `AIChatNodeProps` 增加该可选字段。
   - `core/workflow/template/system/aiChat/index.ts`: chatNode inputs 的 `// settings modal` 区段(jsonSchema 之后)新增 hidden input。
   - `packages/web/i18n/{zh-CN,en,ja}/app.json`: 增加 `extra_body`、`extra_body_tip`。

2. **packages/service**
   - `core/ai/llm/request.ts`:
     - `LLMRequestBodyType` 增加自定义字段 `extraBody?: Record<string, any> | string`。
     - `llmCompletionsBodyFormat` 解构出 `extraBody`(不进入 `...body` 透传),解析(字符串用 json5.parse,解析失败 `throw new Error('Extra body error')`;空串/空对象视为无),在现有 `...modelData?.defaultConfig` 之后再展开合并:
       ```ts
       requestBody = {
         ...requestBody,
         ...modelData?.defaultConfig,
         ...formatExtraBody
       };
       ```
     - 为便于单测,可将解析+合并逻辑抽为可导出的纯函数。
   - `core/workflow/dispatch/ai/chat.ts`: params 解构 `aiChatExtraBody`,body 增加 `extraBody: aiChatExtraBody`。
   - 单元测试(test/cases 下,参照现有 llm 相关测试与 `test/setupModels.ts`):验证
     1. extraBody 合入请求体;
     2. 与 defaultConfig 键冲突时 extraBody 优先;
     3. 非法 JSON 抛错;
     4. 空值不影响原行为。

3. **前端弹窗与节点渲染(projects/app)**
   - `components/core/ai/AISettingModal/index.tsx`:
     - 新增 prop `showExtraBody = true`;
     - 在 JSON Schema 区块之后(输出思考之前)新增一行:Label「Body 额外字段」+ QuestionTip + Switch(`undefined` ↔ `''`),内容区为 `JsonEditor`(复用现有组件,disabled 态与 stopSign 行一致);值存表单 key `NodeInputKeyEnum.aiChatExtraBody`(原始字符串,与 aiChatJsonSchema 同方式)。
   - `components/core/ai/SettingLLMModel/index.tsx`: 透传 `showExtraBody`。
   - `pageComponents/app/detail/WorkflowComponents/Flow/nodes/render/RenderInput/templates/SettingLLMModel.tsx`:
     - `llmModelData` 聚合读取 `aiChatExtraBody`;
     - `showExtraBody` 按 `inputs.some(i => i.key === NodeInputKeyEnum.aiChatExtraBody)` 传入(无该 input 的节点自动隐藏)。
   - ChatAgent `EditForm.tsx`: 若其表单不落盘该字段,则传 `showExtraBody={false}`。

4. **简易应用同步(projects/app)**
   - `pageComponents/app/detail/Edit/SimpleApp/utils.ts`:
     - `appWorkflow2Form`: 从 chatNode inputs 读 `aiChatExtraBody` 入 `aiSettings`;
     - `form2AppWorkflow` 的 `aiChatTemplate`: 将 `aiSettings.aiChatExtraBody` 写回 chatNode inputs(仅当有值);
     - toolTemplates(toolCall 节点)暂不写入。
   - 确认 `AppFormEditFormType['aiSettings']` 类型自动覆盖新字段(基于 SettingAIDataType 则无需改)。

### 合并语义与边界

- 合并发生在请求体过滤空值、裁剪不支持参数、fieldMap 之后,与 defaultConfig 当前行为一致;extraBody 中显式 `null` 会保留(与 defaultConfig 一致)。
- extraBody 可覆盖标准字段(如 temperature),与 defaultConfig 文档语义一致。
- 节点 input 为 string 类型,运行时会先做 `{{变量}}` 替换再 JSON 解析,与 aiChatJsonSchema 行为一致。
- Agent 节点、工具调用节点本期不生效(弹窗自动隐藏,不写 input,无静默失效)。

## TODO

- [x] 1. global 层:枚举/类型/chatNode 模板/三语 i18n(注:仓库实际语言为 zh-CN/en/zh-Hant,无 ja 目录)
- [x] 2. service 层:request.ts 合并逻辑(parseExtraBody)+ chat.ts dispatch + 单元测试(packages/service/test/core/ai/llm/extraBody.test.ts,11 个用例通过)
- [x] 3. 前端:AISettingModal UI + SettingLLMModel 透传 + 工作流 RenderInput 聚合/条件展示 + ChatAgent(showExtraBody=false,因其生成 AgentNode 不落盘该字段)
- [x] 4. 简易应用:SimpleApp utils 双向同步 + AppFormEditFormV1TypeSchema 补 zod 字段
- [x] 5. 收尾:lint 变更文件(通过)、projects/app tsc(通过)、局部测试(35 通过)、全量测试(根 pnpm test 因 @fastgpt/admin 子模块未初始化而不可用,改跑 test:global/test:service/test:app,全部通过)
