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
3. **前端列表页**:`projects/app/src/pages/dashboard/agent/index.tsx`(及 tool 列表共用),Context 在 `projects/app/src/pageComponents/dashboard/agent/context.tsx`,`getMyApps({ parentId, type, searchKey })`,`refreshDeps: [searchKey, parentId, type]` + 500ms throttle。
4. **模型选项来源**:`useSystemStore` 中已有 `llmModelList / embeddingModelList / ttsModelList / reRankModelList / sttModelList`;现成模型选择器组件 `projects/app/src/components/Select/AIModelSelector.tsx`。

### 筛选语义

- 筛选匹配应用**当前编辑态**(app 文档的 modules/chatConfig),不含已发布版本快照。
- 匹配到任意一处引用(工作流节点模型 / rerank / 搜索拓展 / TTS / 问题引导)即视为「使用了该模型」。

### 边界(本期不做)

- ~~按 embedding 模型筛选(需联查数据集的 vectorModel)~~ → **已实现**:embedding 模型挂在知识库(`MongoDataset.vectorModel`)上,因此改为在**知识库列表页**按 `vectorModel` 筛选(见下文「知识库列表按索引模型筛选」)。
- 按已发布版本快照筛选。
- 反向视图:在模型管理页展示「使用此模型的应用」(本期以列表页筛选满足核心诉求,可作为后续增强)。

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
| A. Mongo 查询条件 | `ListAppBody` 增加 `modelId`,`findAppsQuery` 中追加 `$or` 匹配 `modules.inputs` elemMatch + `chatConfig` 路径 | 零迁移;过滤在 DB 层,与 searchKey 的 limit=50 兼容 | modules 无索引,最坏集合扫描;但查询已被 teamId+权限 idList 收敛,数据量可控 |
| B. 服务端内存过滤 | 查出 apps 后在内存中遍历 modules 匹配 | 实现最简单 | 与 searchKey 场景的 limit=50 冲突(先截断再过滤会漏) |
| C. 冗余字段 `usedModels` | 在 update/publish 写路径提取模型 id 数组并建索引 | 查询性能最好 | 需存量迁移;写路径散落多处,一致性风险高 |

**选择方案 A**:数据量经 teamId + 权限收敛后可控,无迁移成本,与现有 searchKey/limit 逻辑天然兼容。若后续出现性能问题再升级为方案 C。

### 后端改造

1. `projects/app/src/pages/api/core/app/list.ts`:
   - `ListAppBody` 增加 `modelId?: string`。
   - `findAppsQuery` 中,当 `modelId` 存在时追加:
     ```ts
     {
       $or: [
         { modules: { $elemMatch: { inputs: { $elemMatch: { key: { $in: ['model', 'rerankModel', 'datasetSearchExtensionModel', 'datasetDeepSearchModel'] }, value: modelId } } } } },
         { 'chatConfig.ttsConfig.model': modelId },
         { 'chatConfig.questionGuide.model': modelId }
       ]
     }
     ```
     - 嵌套 `$elemMatch` MongoDB 支持;key 常量取自 `NodeInputKeyEnum`(packages/global/core/workflow/constants.ts)。
     - searchKey 分支和常规分支都要合并该条件(放在顶层 data 中即可,与 `type`/`searchMatch` 平级)。

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

- `modelId` 为可选参数,不传时行为与现状完全一致。
- 已删除模型(下拉中不存在)不影响查询逻辑;模型 id 直接透传。
- 大团队 modules 无索引,列表查询会变慢——经 teamId + 权限 idList 收敛后风险可接受,需灰度观察。

## TODO

- [x] 后端:`ListAppBody` 增加 `modelId`,`findAppsQuery` 合并模型匹配条件
- [x] 前端:context 增加 `searchModelId` state 并接入请求与 refreshDeps
- [x] 前端:agent 列表页增加模型筛选下拉(复用 useSystemStore 模型列表)
- [x] i18n:新增筛选占位文案(zh-CN / en / zh-Hant)
- [x] 测试:typecheck + ESLint + 全量测试通过
- [x] (可选)tool 列表页同步增加筛选

## 待确认问题

1. 筛选范围是否覆盖全部模型引用点(LLM 节点模型、rerank、数据集搜索拓展/深度搜索、TTS、问题引导)?还是只筛 LLM 主模型?
2. 下拉选项范围:仅团队可用模型(`getMyModelList`),还是全部激活模型?
3. 是否需要在筛选结果中「高亮」每个应用使用了该模型的位置(如节点数量)?本期默认不做,仅过滤。
