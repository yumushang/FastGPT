# 应用列表支持按「使用模型」筛选

## 需求分析

### 背景与痛点

用户在替换/下线某个模型时，需要在团队内逐个打开应用（智能体/工作流）排查哪些应用正在使用该模型，过程繁琐且容易遗漏。需要在应用列表页面直接按模型筛选出正在使用某模型的应用。

### 用户故事

- 作为团队成员，我希望在「我的应用」列表页选择一个模型后，列表只展示当前正在使用该模型的应用，以便快速完成模型替换/迁移。

### 现状分析

1. **应用列表查询**:`projects/app/src/pages/api/core/app/list.ts`
   - 请求体 `ListAppBody`(list.ts:24):`{ parentId?, type?, searchKey? }`,仅支持文件夹、类型、关键词(匹配 name/intro/API key)。
   - 查询 projection 已包含 `modules` 字段(list.ts:168,用于计算 `hasInteractiveNode`),返回前剔除。即服务端已经拉取了全量 modules,做模型匹配无需额外查库。
2. **模型引用存储位置**(模型均为字符串 id):
   - 工作流节点 `modules[].inputs[]` 中:
     - `key = 'model'`(AI 对话等 LLM 节点,`NodeInputKeyEnum.aiModel`)
     - `key = 'rerankModel'`(数据集搜索 rerank 模型)
     - `key = 'datasetSearchExtensionModel'` / `key = 'datasetDeepSearchModel'`(数据集搜索拓展模型)
   - `chatConfig` 中:
     - `chatConfig.ttsConfig.model`(TTS 模型)
     - `chatConfig.questionGuide.model`(问题引导生成模型)
   - **不涉及**:embedding 模型挂在数据集(`MongoDataset.vectorModel`)上,不在 app modules 中;要按 embedding 模型筛选需联查数据集,本期不做(见「边界」)。
   - **2026-10-29 补充**:以上是初版分析时的引用点,并不完整。实际还存在 `agent_datasetParams` 对象 value 内、旧 `systemConfig`(userGuide)节点内、`renderTypeList` 含 `selectLLMModel` 的自定义输入、表单输入默认值、`llmSelect` 变量默认值等位置,完整清单见文末「修复语义」与「回归测试覆盖」。
3. **前端列表页**:`projects/app/src/pages/dashboard/agent/index.tsx`(及 tool 列表共用),Context 在 `projects/app/src/pageComponents/dashboard/agent/context.tsx`,`getMyApps({ parentId, type, searchKey })`,`refreshDeps: [searchKey, parentId, type]` + 500ms throttle。
4. **模型选项来源**:`useSystemStore` 中已有 `llmModelList / embeddingModelList / ttsModelList / reRankModelList / sttModelList`;现成模型选择器组件 `projects/app/src/components/Select/AIModelSelector.tsx`。

### 筛选语义

- 筛选匹配应用**当前编辑态**(app 文档的 modules/chatConfig),不含已发布版本快照。
- 匹配到任意一处引用(工作流节点模型 / rerank / 搜索拓展 / TTS / 问题引导)即视为「使用了该模型」。
- **筛选范围是全团队,不是当前文件夹**(2026-10-29 线上漏筛修复后的语义,详见文末「线上漏筛复盘与修复」):`parentId` 只在「既无 `searchKey` 也无 `modelId`」时用于文件夹浏览;传入 `searchKey` 或 `modelId` 时后端走团队级查询,结果覆盖团队内所有文件夹层级。

### 边界(本期不做)

- ~~按 embedding 模型筛选(需联查数据集的 vectorModel)~~ → **已实现**:embedding 模型挂在知识库(`MongoDataset.vectorModel`)上,因此改为在**知识库列表页**按 `vectorModel` 筛选(见下文「知识库列表按索引模型筛选」)。
- 按已发布版本快照筛选。
- 反向视图:在模型管理页展示「使用此模型的应用」(本期以列表页筛选满足核心诉求,可作为后续增强)。
- 变量动态引用的模型、空值回退默认模型、子应用/工具间接引用:单条 Mongo 查询无法覆盖,见文末「仍未覆盖的边界」。

## 知识库列表按索引模型筛选(补充需求)

### 需求

embedding 模型挂在知识库上而非应用上。用户替换/下线 embedding 模型时,需要快速找出使用该模型的知识库。

### 实现

1. **契约**:`packages/global/openapi/core/dataset/api.ts` `GetDatasetListBodySchema` 增加 `vectorModel: z.string().optional()`。
2. **后端**:`projects/app/src/pages/api/core/dataset/list.ts` 在搜索分支与普通分支均追加 `vectorModel` 等值匹配(顶层字符串字段,无需 `$elemMatch`)。
3. **前端**:
   - `projects/app/src/components/Select/ModelFilterSelect.tsx`(由 `pageComponents/dashboard/agent/` 迁移而来,供 app 与 dataset 页面共用)增加 `models` 属性,可覆盖默认候选列表(默认 LLM + TTS + ReRank)。
   - `projects/app/src/pageComponents/dataset/list/context.tsx` 增加 `searchModelId`,以 `vectorModel: searchModelId` 请求并加入 `refreshDeps`。
   - `projects/app/src/pages/dataset/list/index.tsx`(PC + 移动端)搜索框旁加模型筛选,`models` 传 `useSystemStore` 的 `embeddingModelList`。
4. **i18n**:筛选文案 key 放在 `common` 命名空间(`common:filter_by_model` / `common:all_models`,zh-CN / en / zh-Hant),app 与 dataset 页面共用。

### 范围说明

- 知识库仅按 `vectorModel`(索引模型)筛选;`agentModel` / `vlmModel` 不纳入(属于处理模型,替换场景不同,可后续按需扩展)。
- rerank 模型不落库到 dataset(仅搜索时参数),不在筛选范围。

## 技术设计

### 方案选择

候选方案:

| 方案 | 说明 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. Mongo 查询条件 | `ListAppBody` 增加 `modelId`,`findAppsQuery` 中用独立条件块匹配 `modules.inputs`(含嵌套 `agent_datasetParams`、旧 `systemConfig` 节点)+ `chatConfig` 路径 | 零迁移;过滤在 DB 层,与 searchKey 的 limit=50 兼容 | modules 无索引,最坏集合扫描;筛选时按团队级查询,候选集更大 |
| B. 服务端内存过滤 | 查出 apps 后在内存中遍历 modules 匹配 | 实现最简单 | 与 searchKey 场景的 limit=50 冲突(先截断再过滤会漏) |
| C. 冗余字段 `usedModels` | 在 update/publish 写路径提取模型 id 数组并建索引 | 查询性能最好 | 需存量迁移;写路径散落多处,一致性风险高 |

**选择方案 A**:无迁移成本,与现有 searchKey 逻辑兼容。筛选态是团队级查询(权限只做内存兜底),候选集比文件夹浏览大,靠 `type` / `deleteTime` / `teamId` 收敛;带 `modelId` 时不做 DB 预截断,结果集大小由命中量决定。若后续出现性能问题再升级为方案 C。

### 后端改造

> 2026-10-29 更新:初版实现的查询形状(`$or` 直接铺在顶层)已被线上漏筛证伪。下面是**修复后已落地的实现**;根因与回归用例见文末「线上漏筛复盘与修复」。

1. `projects/app/src/pages/api/core/app/list.ts`:
   - `ListAppBody` 增加 `modelId?: string`。
   - `const isTeamWide = !!(searchKey || modelId)`:团队级查询时 `appPerQuery = {}`(不再限制 `parentId`,也不再在 DB 层用权限 `$or` 收窄),否则维持原有文件夹 + 权限块。
   - 当 `modelId` 存在时,`modelMatch` 覆盖以下引用点(均为字符串等值,统一包成 `moduleInputMatch()`):
     ```ts
     // 1) 平铺 input:工作流/简单应用把模型直接作为 input 存储
     { key: { $in: ['model', 'rerankModel', 'datasetSearchExtensionModel', 'datasetDeepSearchModel'] },
       value: modelId }
     // 2) 嵌套在 agent_datasetParams 对象 value 内(ChatAgent 编辑态),含 deep search
     { key: 'agent_datasetParams', $or: [
       { 'value.rerankModel': modelId },
       { 'value.datasetSearchExtensionModel': modelId },
       { 'value.datasetDeepSearchModel': modelId }
     ] }
     // 3) 旧 systemConfig(userGuide)节点内的 TTS / 问题引导配置
     { modules: { $elemMatch: { flowNodeType: 'userGuide', inputs: { $elemMatch: {
       key: { $in: ['tts', 'questionGuide'] }, 'value.model': modelId
     } } } } }
     // 4) 自定义模型输入框:renderTypeList 含 selectLLMModel 的 input,当前值或默认值
     { renderTypeList: FlowNodeInputTypeEnum.selectLLMModel,
       $or: [{ value: modelId }, { defaultValue: modelId }] }
     // 5) 表单输入节点(userInputForms)中 selectLLMModel 字段的默认值
     { key: 'userInputForms', value: { $elemMatch: {
       type: FlowNodeInputTypeEnum.selectLLMModel, defaultValue: modelId
     } } }
     // 6) 应用变量中 llmSelect 变量的默认值
     { 'chatConfig.variables': { $elemMatch: {
       type: VariableInputEnum.llmSelect, defaultValue: modelId
     } } }
     // 7) chatConfig 显式配置
     { 'chatConfig.ttsConfig.model': modelId }
     { 'chatConfig.questionGuide.model': modelId }
     ```
   - **禁止再把多组条件各自以顶层 `$or` 展开后 spread 合并**:JS 对象展开对同名键是覆盖而非合并,`searchMatch.$or`、权限块 `$or`、`modelMatch.$or` 会互相覆盖(详见复盘)。现实现把 `appPerQuery`、`searchMatch`、`modelMatch` 放进 `$and: [ ... ]`,空对象会被 filter 掉。
   - **团队级语义由 `isTeamWide` 统一控制**:`searchKey` 与 `modelId` 都不传时保持文件夹浏览;任一存在时跨文件夹。
   - **DB 预截断只在纯关键词搜索时生效**:`searchKey && !modelId` 才 `limit: 50`;带 `modelId` 时不预截断。原因:无 `modelId` 时权限块已在 DB 层收窄,50 条语义与原来一致;一旦带 `modelId`,权限变成查询后的 `hasReadPer` 内存过滤,先截断 50 条会把本应有权限、但 `updateTime` 较老的命中项挤掉。searchKey 与 modelId 仍必须同时生效。

### 前端改造

1. `projects/app/src/pageComponents/dashboard/agent/context.tsx`:
   - `AppListContextType` 增加 `searchModelId?: string` 与 `setSearchModelId`。
   - `getMyApps({ ..., modelId: searchModelId })`;`refreshDeps` 加入 `searchModelId`。
2. `projects/app/src/pages/dashboard/agent/index.tsx`(PC :136-145 / 移动端 :172-185 搜索框旁):
   - 新增模型筛选下拉:选项 = `useSystemStore` 的 `llmModelList` + `reRankModelList` + `ttsModelList`(去重,按 provider 分组,带 avatar),外加「全部」清除项。
   - 复用 `AIModelSelector` 或轻量 `MySelect`,宽度自适应,默认「按模型筛选」占位。
   - tool 列表页(tool/index.tsx)同样受益于 context 改动,本期可只上 agent 页,tool 页视实现成本一并处理。
3. i18n:`app` 命名空间下新增 key(如 `filter_by_model`),补齐 zh-CN / en / ja(或复用现有 i18n 脚本约定)。

### 兼容与风险

- `modelId` 为可选参数,不传时行为与现状完全一致(含文件夹浏览)。
- 已删除模型(下拉中不存在)不影响查询逻辑;模型 id 直接透传。但下拉候选只来自「我的可用模型」(`ModelFilterSelect` + `getMyModelList`),已从团队配置移除的模型无法在 UI 选中。
- 传 `modelId` 时按团队级查询:候选集不再被权限 `$or` 收窄,只靠返回前的 `hasReadPer` 内存过滤兜底,大团队的扫描量与内存开销会上升,需灰度观察;modules/chatConfig 无对应索引,后续若成瓶颈再升级为方案 C(冗余 `usedModels`)。
- 带 `modelId` 时没有 DB 预截断(见修复语义),命中多少返回多少;纯 `searchKey` 仍限 50。前端列表需要能承载较长的结果,若要分页/上限,应在内存过滤之后做,不能回到 DB 预截断。
- 团队级结果会跨文件夹,列表项只带 `parentId`,前端需要给出「结果来自全部文件夹」的提示或展示路径,否则用户会误以为结果不属于当前文件夹。

## 线上漏筛复盘与修复(2026-10-29)

> 排查过程、复现步骤与运维侧核对方法见 issue:[`app-model-filter-missing.md`](../../../issue/app-model-filter-missing.md)。

### 现象

按模型筛选上线后,用户反馈「明明用着这个模型,却筛不出来」,且同一模型在不同应用上表现不一致:有的能筛出、有的不能;在子文件夹里筛选时漏得最明显。

### 根因(5 条,均已定位到代码)

> 本节行号基于修复前版本(`git show HEAD:projects/app/src/pages/api/core/app/list.ts`,即 `623ec6448` 引入的实现);修复后行号已变化,以文件内容为准。

#### 1. 文件夹作用域:`parentId` 一直生效

- `projects/app/src/pages/api/core/app/list.ts:186-192` 非搜索分支把 `...parseParentIdInMongo(parentId)` 展开在最后,`parentId` 条件始终存在(实现见 `packages/global/common/parentFolder/utils.ts:3`)。
- 前端 `projects/app/src/pageComponents/dashboard/agent/context.tsx:69-72,112` 把路由 query 里的 `parentId` 原样传给 `getMyApps`,选模型不会清空它。
- 结果:筛选只在「当前这一层」生效,根级/其他文件夹/更深层的应用全部被排除;而 searchKey 分支(`list.ts:172-184`)反而 `delete data.parentId` 做全团队搜索——两个入口语义不一致,表现为「有时候筛得出、有时候筛不出」。

#### 2. `$or` 键覆盖:组合条件互相顶掉

- 三块条件都用顶层 `$or`:权限块 `appPerQuery`(`list.ts:118-122`)、`searchMatch`(:124-132)、`modelMatch`(:144-170)。
- 合并方式是对象展开:
  - 非搜索分支 `{...appPerQuery, teamId, type, ...modelMatch, ...parseParentIdInMongo(parentId)}`(:186-192)→ `modelMatch.$or` 覆盖权限块 `$or`,DB 层权限收窄失效,只剩返回前的内存 `hasReadPer` 兜底;
  - 搜索分支 `{...appPerQuery, teamId, ...searchMatch, ...modelMatch, type}`(:172-179)→ `modelMatch.$or` 覆盖 `searchMatch.$or`,**选了模型后关键词条件被静默丢弃**(若调换展开顺序则变成模型条件被丢弃)。
- JS 对象展开对同名键是覆盖而非合并,这是「组合条件失效」的机制性根因,与数据无关。

#### 3. `agent_datasetParams` 嵌套:知识库参数写在一个对象里

- ChatAgent(简单 Agent)编辑态把知识库参数整体写成一个对象型 input:`key = agent_datasetParams`,`value = { datasets, rerankModel, datasetSearchExtensionModel, ... }`(`projects/app/src/pageComponents/app/detail/Edit/ChatAgent/utils.ts:235-255`;常量见 `packages/global/core/workflow/constants.ts:174`)。
- 查询只匹配「同级 inputs 中 key 为 `rerankModel` / `datasetSearchExtensionModel` 且 value 等于模型 id」,嵌套在对象 value 里的字段永远命中不到;而运行时读的正是 `datasetParams.rerankModel / .datasetSearchExtensionModel`(`packages/service/core/workflow/dispatch/ai/agent/master/call.ts:376-381`)。
- 对照:工作流数据集搜索节点与 SimpleApp 是平铺 key(`packages/global/core/workflow/template/system/datasetSearch.ts:107`、`projects/app/src/pageComponents/app/detail/Edit/SimpleApp/utils.ts:459-480`),所以同一模型「工作流里筛得出、ChatAgent 里筛不出」。

#### 4. 旧 systemConfig 节点:历史应用把 TTS/问题引导模型存节点里

- 全局配置节点 `flowNodeType = userGuide`(`FlowNodeTypeEnum.systemConfig = 'userGuide'`,见 `packages/global/core/workflow/node/constant.ts:129`)的 inputs 里存 `tts` / `questionGuide` 对象;`splitGuideModule` 从节点读(`packages/global/core/workflow/utils.ts:77-100`),`getAppChatConfig` 以数据库 `chatConfig` 优先、节点值兜底(:130-176)。
- 历史应用/模板把模型写在 `tts.value.model` / `questionGuide.value.model`(`projects/app/src/web/core/app/templates.ts:56-75,297-310`),查询只看 `chatConfig.ttsConfig.model` / `chatConfig.questionGuide.model`(`list.ts:166-167`),这类应用漏筛;新应用通常写 `chatConfig`,所以「新应用筛得出、老应用筛不出」。

#### 5. 50 条 DB 预截断:搜索 + 模型组合时提前丢行

- 修复前 `const limit = searchKey ? 50 : undefined`(`list.ts:194-197`)只判断 searchKey,查询在 DB 层先按 `updateTime` 取 50 条,再回内存做 `hasReadPer` 过滤。
- 一旦同时带 `searchKey` 和 `modelId`,权限块已被 `modelMatch.$or` 覆盖(根因 2),这 50 条是「模型命中集」里最新的 50 条;团队里使用该模型的应用超过 50 个时,较老的命中项在截断阶段就丢了,后续任何过滤都救不回来。
- 表现为:大团队里按「关键词 + 模型」筛,结果条数总是 50,部分明明命中的应用不出现。

### 修复语义:全团队筛选

- **`isTeamWide = !!(searchKey || modelId)`**:任一筛选条件存在即走团队级查询,`appPerQuery = {}`(不再限制 `parentId`,也不再在 DB 层用权限 `$or` 收窄);两者都不传时保持文件夹浏览语义不变。
- **权限不变**:`teamId` 与返回前的 `hasReadPer` 过滤仍是最终闸门(`list.ts` 末尾的 `formatApps(...).filter(app => app.permission.hasReadPer)`),文件夹继承权限由 `getPer(parentId)` 兜底;只是 DB 层不再用权限 `$or` 收窄候选集(被覆盖后本来也没生效),需接受候选集变大的成本。
- **多条件一律 `$and` 组合**:`appPerQuery`、`searchMatch`、`modelMatch` 各占一个元素,空对象被过滤,不再依赖顶层 `$or` spread;`type` 过滤与 `deleteTime: null` 保持不变。
- **扩展 modelMatch 覆盖面**:平铺 input(`model`/`rerankModel`/`datasetSearchExtensionModel`/`datasetDeepSearchModel`)+ `agent_datasetParams` 内的 `value.rerankModel` / `.datasetSearchExtensionModel` / `.datasetDeepSearchModel` + 旧 `systemConfig` 节点的 `tts.value.model` / `questionGuide.value.model` + `renderTypeList` 含 `selectLLMModel` 的自定义输入(`value` 或 `defaultValue` 任一命中)+ `userInputForms` 里 selectLLMModel 字段默认值 + `chatConfig.variables` 里 `llmSelect` 变量默认值 + `chatConfig.ttsConfig.model` / `chatConfig.questionGuide.model`。
- **searchKey + modelId 必须同时生效**;DB 预截断规则改为:
  - 纯 `searchKey`(`searchKey && !modelId`)仍 `limit: 50`,与旧行为一致;
  - 带 `modelId` 时**不做 50 条预截断**(`limit` 为 undefined)。因为有 `modelId` 时权限是查询后的 `hasReadPer` 内存过滤,先截断 50 条会把有权限但较老的命中项挤掉(根因 5);代价是结果集不设上限,大团队列表可能很长。

参考形状(与已落地实现一致):

```ts
const isTeamWide = !!(searchKey || modelId);
// 原有父级 + 权限块（仅文件夹浏览时使用）
const appPerQuery = isTeamWide ? {} : folderScopeQuery;

const andConditions = [
  appPerQuery,
  ...(searchKey ? [searchMatch] : []),
  ...(modelId ? [modelMatch] : [])
].filter((item) => Object.keys(item).length > 0);

const findAppsQuery = {
  teamId,
  type: _type,
  ...(andConditions.length > 0 ? { $and: andConditions } : {})
};
```

### 回归测试覆盖

`projects/app/test/api/core/app/list.test.ts`(Vitest + mongodb-memory-server,直接调用 `list` 路由 handler):

| # | 用例 | 覆盖点 |
| --- | --- | --- |
| 1 | 平铺 `model` input 命中 / 不命中 | 基础匹配 |
| 2 | `agent_datasetParams` 内的 `rerankModel`、`datasetSearchExtensionModel` | 根因 3 |
| 3 | 旧 `systemConfig` 节点 `tts.value.model`、`questionGuide.value.model` | 根因 4 |
| 4 | `chatConfig.ttsConfig.model`、`chatConfig.questionGuide.model` | 基础匹配 |
| 5 | 自定义模型输入(selectLLMModel)的 `value` 与 `defaultValue`、表单输入默认值、`llmSelect` 变量默认值命中;普通输入/普通变量不误判 | 补充引用点 |
| 6 | 不使用该模型的应用不出现在结果中 | 无误报 |
| 7 | 传 `modelId` 时同时返回根级与子文件夹应用;不传时仍只返回当前层 | 根因 1(全团队语义) |
| 8 | `searchKey` + `modelId` 同时生效(`alpha`+模型、`beta`+模型) | 根因 2 |
| 9 | 非 owner:文件夹共享后的继承权限应用能筛出,无权限应用不返回;进入该文件夹浏览时同样正常 | 权限后置过滤 + 文件夹继承 |
| 10 | 关键词命中 56 条(55 filler + 1 最老目标)时,`searchKey` + `modelId` 不丢命中项(返回 56 条);纯 `searchKey` 仍只返回 50 条 | 根因 5(防 50 条预截断) |

运行:`cd projects/app && pnpm test test/api/core/app/list.test.ts`
2026-10-29 本地单文件实测:**10/10 通过**;全量测试(app / global / service)3/3 通过。

建议补充(当前用例未覆盖,优先级从高到低):

- `datasetDeepSearchModel` 平铺 key(嵌套形态已覆盖)。
- `type` 与 `modelId` 组合(agent / tool 页各自类型过滤)。
- 不传 `modelId` 的列表结果与筛选上线前完全一致(防回归)。

### 仍未覆盖的边界(明确不做)

| 场景 | 为什么覆盖不了 |
| --- | --- |
| 变量动态引用 | 节点 value 可以是 `[nodeId, outputId]` 引用(`packages/global/core/workflow/utils.ts:390+`),真实模型运行时才解析;DB 等值匹配命中不到。注意:`llmSelect` 变量的**默认值**已覆盖,运行时被覆盖/被引用传值的情况不覆盖。 |
| 空值回退默认模型 | 未填模型时运行时回退系统默认模型(`packages/service/core/ai/model.ts:6-10` 等),文档里没有该 id;按默认模型筛选需要额外「默认模型」选项或反查默认配置,语义也会变。 |
| 发布版本快照 | 列表只看 app 文档的 `modules`/`chatConfig`;每个发布版本的节点存于 `app_versions`(`packages/service/core/app/version/schema.ts:24-31`),编辑态与线上运行版本可能不同。 |
| 子应用/工具间接引用 | 主应用通过 `agent_selectedTools`(`NodeInputKeyEnum.selectedTools` = `agent_selectedTools`)或「运行应用」节点(appModule)引用工具/子应用,模型落在被引用应用里;单条 Mongo 查询无法跨应用递归。 |

## TODO

- [x] 后端:`ListAppBody` 增加 `modelId`,`findAppsQuery` 合并模型匹配条件
- [x] 前端:context 增加 `searchModelId` state 并接入请求与 refreshDeps
- [x] 前端:agent 列表页增加模型筛选下拉(复用 useSystemStore 模型列表)
- [x] i18n:新增筛选占位文案(zh-CN / en / zh-Hant)
- [x] 测试:typecheck + ESLint + 全量测试通过
- [x] (可选)tool 列表页同步增加筛选
- [x] 2026-10-29 漏筛修复:团队级筛选(`isTeamWide`)+ `$and` 组合 + 扩展 modelMatch(agent_datasetParams / 旧 systemConfig / 自定义模型输入 value+defaultValue / 表单默认值 / llmSelect 变量)
- [x] 2026-10-29 漏筛修复:带 `modelId` 时取消 50 条 DB 预截断,纯 `searchKey` 仍限 50(权限后置过滤不能被预截断挤掉)
- [x] 2026-10-29 漏筛修复:回归测试 `projects/app/test/api/core/app/list.test.ts` 扩到 10 个用例(新增非 owner 文件夹继承权限、56 条防截断),本地单文件 10/10 通过
- [x] 2026-10-29 漏筛修复:全量测试(app / global / service)3/3 通过
- [x] 2026-10-29 漏筛修复:typecheck / ESLint 通过
- [ ] 2026-10-29 漏筛修复:剩余建议用例(`datasetDeepSearchModel` 平铺 key、type+modelId 组合、不传 modelId 防回归)
- [ ] 2026-10-29 漏筛修复:前端在筛选态提示「结果来自全部文件夹」(UX,待产品确认)

## 待确认问题

1. 筛选范围是否覆盖全部模型引用点(LLM 节点模型、rerank、数据集搜索拓展/深度搜索、TTS、问题引导)?还是只筛 LLM 主模型?
2. 下拉选项范围:仅团队可用模型(`getMyModelList`),还是全部激活模型?
3. 是否需要在筛选结果中「高亮」每个应用使用了该模型的位置(如节点数量)?本期默认不做,仅过滤。
