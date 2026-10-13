# 应用按模型筛选漏筛问题分析

> 关联设计文档:[`design/core/app/filter-app-by-model.md`](../design/core/app/filter-app-by-model.md)
> 引入版本:commit `623ec6448`(应用/工具/知识库列表支持按使用模型筛选)
> 分析日期:2026-10-29

## 现象

用户部署新版后,在「我的应用」列表按模型筛选,部分**确实在使用该模型**的应用不出现。表现不一致:

- 在子文件夹里筛选时漏得最明显,根级列表里筛得出的应用,进文件夹后筛不出;
- 简单 Agent 类应用(ChatAgent 编辑的知识库 rerank / 查询拓展模型)筛不出,普通工作流筛得出;
- 老应用(TTS / 问题引导模型配在全局配置节点)筛不出,新建应用筛得出;
- 同时输入关键词并选择模型时,结果集不对(有时是关键词失效,有时是模型条件失效);
- 大团队里「关键词 + 模型」一起筛时,结果条数固定为 50,较老的命中应用被截掉(团队内使用该模型的应用超过 50 个才暴露)。

知识库按索引模型筛选是顶层标量等值匹配(`vectorModel`),不会被 `$or` 覆盖,因此不受本次问题影响(它仍保留文件夹作用域,属于既有行为)。问题只出在应用/工具列表的 `modelId` 查询。

## 复现路径

1. 在团队下新建两个应用:`A` 放在根级、AI 节点模型选 `gpt-4o`;`B` 放在子文件夹里、模型同样选 `gpt-4o`。
2. 回到根级,模型筛选选 `gpt-4o` → 只能看到 `A`(漏 `B`)。进入子文件夹再筛 → 只能看到 `B`。
3. 新建一个「简单 Agent」应用,把知识库检索的 rerank 模型设为 `rerank-x`,按 `rerank-x` 筛选 → 筛不出该应用。
4. 老应用(升级前的模板,TTS/问题引导模型存在 `userGuide` 节点 inputs 里)按对应 TTS 模型筛选 → 筛不出。
5. 关键词输入 `alpha` 同时选模型 → 返回结果忽略关键词(或反之,取决于条件展开顺序)。
6. 造 56 个名称含 `bulk`、都使用 `bulk-model` 的应用(目标应用 `updateTime` 最老),按关键词 `bulk` + 模型 `bulk-model` 筛选 → 只返回 50 条,最老的目标应用缺失。

## 根因

五处独立缺陷叠加:第 1、2 处是查询结构问题(作用域、`$or` 覆盖),第 3、4 处是「模型引用位置」覆盖不全,第 5 处是 DB 预截断与后置权限过滤的顺序冲突。

### 1. 文件夹作用域:`parentId` 一直生效

修复前 `projects/app/src/pages/api/core/app/list.ts` 非搜索分支:

```ts
return {
  ...appPerQuery,
  teamId,
  type: _type,
  ...modelMatch,
  ...parseParentIdInMongo(parentId)   // 永远把 parentId 加回来
};
```

- `parseParentIdInMongo`(`packages/global/common/parentFolder/utils.ts:3`)对合法 ObjectId 返回 `{ parentId }`,所以筛选只在当前这一层生效;
- 前端 `projects/app/src/pageComponents/dashboard/agent/context.tsx:69-72,112` 把路由 query 的 `parentId` 原样传给 `getMyApps`,选模型不会清空它;
- 而 searchKey 分支反而 `delete data.parentId` 做全团队搜索,两个入口语义不一致,导致「有时筛得出、有时筛不出」。

### 2. `$or` 键覆盖:组合条件互相顶掉

三块条件都用顶层 `$or`:

- 权限块 `appPerQuery`(非 owner):`{ $or: [idList, ...] }`
- `searchMatch`(关键词):`{ $or: [name, intro, apiKey 命中的 _id] }`
- `modelMatch`(模型):`{ $or: [节点输入, chatConfig.ttsConfig, chatConfig.questionGuide] }`

合并方式是对象展开:

```ts
// 搜索分支
{ ...appPerQuery, teamId, ...searchMatch, ...modelMatch, type: _type }
// 非搜索分支
{ ...appPerQuery, teamId, type: _type, ...modelMatch, ...parseParentIdInMongo(parentId) }
```

JS 对象展开对同名键是**覆盖**而非合并,因此:

- 搜索分支:`modelMatch.$or` 覆盖 `searchMatch.$or` → 选了模型后关键词条件被静默丢弃;若调换展开顺序则变成模型条件被丢弃;
- 两个分支:权限块 `$or` 都会被覆盖 → DB 层权限收窄失效,只剩返回前的内存 `hasReadPer` 过滤兜底(不泄露数据,但候选集变大);
- 这是机制性缺陷,与具体数据无关,只要同时出现两组 `$or` 就会触发。

### 3. `agent_datasetParams` 嵌套:知识库参数是一个对象值

- ChatAgent(简单 Agent)编辑态把知识库参数整体写成一个对象型 input:
  `key = 'agent_datasetParams'`,`value = { datasets, rerankModel, datasetSearchExtensionModel, ... }`
  (`projects/app/src/pageComponents/app/detail/Edit/ChatAgent/utils.ts:235-255`;常量 `NodeInputKeyEnum.datasetParams` 见 `packages/global/core/workflow/constants.ts:174`)。
- 修复前的查询只匹配「同级 inputs 中 key 为 `rerankModel`/`datasetSearchExtensionModel`、value 等于模型 id」,嵌套在对象 value 里的字段永远命中不到;
- 运行时读取的正是 `datasetParams.rerankModel / .datasetSearchExtensionModel`(`packages/service/core/workflow/dispatch/ai/agent/master/call.ts:376-381`),说明模型确实生效,只是筛不到;
- 对照:工作流数据集搜索节点与 SimpleApp 是平铺 key(`packages/global/core/workflow/template/system/datasetSearch.ts:107`、`projects/app/src/pageComponents/app/detail/Edit/SimpleApp/utils.ts:459-480`),于是出现「工作流筛得出、ChatAgent 筛不出」。

### 4. 旧 `systemConfig` 节点:历史应用把 TTS/问题引导模型存在节点里

- 全局配置节点 `flowNodeType = 'userGuide'`(`FlowNodeTypeEnum.systemConfig = 'userGuide'`,见 `packages/global/core/workflow/node/constant.ts:129`);
- `splitGuideModule` 从该节点 inputs 读取 `tts` / `questionGuide` 对象值(`packages/global/core/workflow/utils.ts:77-100`),`getAppChatConfig` 以数据库 `chatConfig` 优先、节点值兜底(`packages/global/core/workflow/utils.ts:130-176`);
- 迁移前创建/模板创建的应用,模型写在 `tts.value.model` / `questionGuide.value.model`(`projects/app/src/web/core/app/templates.ts:56-75,297-310`),而查询只看 `chatConfig.ttsConfig.model` / `chatConfig.questionGuide.model`,这类应用必然漏筛;
- 「systemConfig」这个命名容易让人以为模型不可能存在节点里,评审时被忽略。

### 5. 50 条 DB 预截断:搜索 + 模型组合时提前丢行

- 修复前 `const limit = searchKey ? 50 : undefined`,只要带 `searchKey` 就在 DB 层按 `updateTime` 取 50 条,再回内存做 `hasReadPer` 过滤;
- 与根因 2 叠加后,同时带 `searchKey` + `modelId` 时这 50 条是「模型命中集」里最新的 50 条,团队里使用该模型的应用超过 50 个时,较老的命中项在截断阶段就丢了,后续过滤救不回来;
- 因此大团队按「关键词 + 模型」筛,结果数固定为 50,部分命中的应用不出现。

## 修复

### 语义:全团队筛选

- `isTeamWide = !!(searchKey || modelId)`:任一筛选条件存在即走团队级查询,`appPerQuery = {}`(不再限制 `parentId`,也不再在 DB 层用权限 `$or` 收窄);两者都不传时保持原有文件夹浏览行为。
- 权限仍由 `teamId` + 返回前的 `hasReadPer` 过滤保证,文件夹继承权限由 `getPer(parentId)` 兜底;代价是候选集变大,大团队需关注扫描量与内存开销。
- **预截断只在纯 `searchKey` 时生效**:`searchKey && !modelId` 才 `limit: 50`;带 `modelId` 时不预截断(权限是查询后的内存过滤,先截断会挤掉有权限的较老命中项)。代价是结果集不设上限。

### 查询:多条件 `$and` 组合

```ts
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

### 匹配:补全模型引用点

`modelMatch.$or` 现在覆盖:

| 引用点 | 条件形态 |
| --- | --- |
| 平铺模型 input | `inputs: { $elemMatch: { key: { $in: ['model','rerankModel','datasetSearchExtensionModel','datasetDeepSearchModel'] }, value: modelId } }` |
| Agent 知识库参数(ChatAgent) | `key: 'agent_datasetParams'` 且 `value.rerankModel` / `value.datasetSearchExtensionModel` / `value.datasetDeepSearchModel` 等于模型 id |
| 旧全局配置节点 | `flowNodeType: 'userGuide'` 且 inputs 中存在 `key: 'tts'`/`'questionGuide'`、`value.model` 等于模型 id |
| 自定义模型输入框 | `renderTypeList` 含 `FlowNodeInputTypeEnum.selectLLMModel`,且 `value` **或** `defaultValue` 等于模型 id |
| 表单输入默认值 | `key: 'userInputForms'` 且 `value.$elemMatch.defaultValue` 等于模型 id(type 为 selectLLMModel) |
| 应用变量默认值 | `chatConfig.variables` 中 `type: llmSelect` 且 `defaultValue` 等于模型 id |
| 聊天配置 | `chatConfig.ttsConfig.model` / `chatConfig.questionGuide.model` |

## 回归测试

`projects/app/test/api/core/app/list.test.ts`(Vitest + mongodb-memory-server,直接调用 `list` 路由 handler),10 个用例:

1. 平铺 `model` input 命中 / 不命中;
2. `agent_datasetParams` 内的 `rerankModel`、`datasetSearchExtensionModel`;
3. 旧 `systemConfig` 节点 `tts.value.model`、`questionGuide.value.model`;
4. `chatConfig.ttsConfig.model`、`chatConfig.questionGuide.model`;
5. 自定义模型输入(selectLLMModel)的 `value` 与 `defaultValue`、表单输入默认值、`llmSelect` 变量默认值命中,普通输入/普通变量不误判;
6. 不使用该模型的应用不返回(无误报);
7. 子文件夹:传 `modelId` 时同时返回根级与子文件夹应用,不传时仍只返回当前层;
8. `searchKey` + `modelId` 同时生效(验证 `$or` 不再互相覆盖);
9. 非 owner:文件夹共享后的继承权限应用能筛出,无权限应用不返回;进入该文件夹浏览时同样正常;
10. 关键词命中 56 条(55 filler + 1 个最老目标)时,`searchKey` + `modelId` 不丢命中项(返回 56 条);纯 `searchKey` 仍只返回 50 条。

运行方式:

```bash
cd projects/app && pnpm test test/api/core/app/list.test.ts
```

2026-10-29 本地单文件实测:10/10 通过;全量测试仍在进行,未确认结果。

建议补充(尚未覆盖):

- `datasetDeepSearchModel` 平铺 key(嵌套形态已覆盖);
- `type` + `modelId` 组合(agent / tool 页各自类型过滤);
- 不传 `modelId` 时结果与筛选上线前一致(防回归)。

## 仍未覆盖的场景(明确不做)

| 场景 | 原因 |
| --- | --- |
| 变量动态引用 | 节点 value 可以是 `[nodeId, outputId]` 引用(`packages/global/core/workflow/utils.ts:390+`),真实模型在运行时解析;DB 等值匹配命中不到。`llmSelect` 变量的默认值已覆盖,但运行时被引用传值/被覆盖的情况不覆盖。 |
| 空值回退默认模型 | 未填模型时运行时回退系统默认模型(`packages/service/core/ai/model.ts:6-10`),文档里没有该 id;按「默认模型」筛选需要额外选项或反查默认配置,语义也会变。 |
| 发布版本快照 | 列表只看 app 文档的 `modules`/`chatConfig`;发布版本的节点存于 `app_versions`(`packages/service/core/app/version/schema.ts:24-31`),编辑态与线上运行版本可能不同。 |
| 子应用/工具间接引用 | 主应用通过 `agent_selectedTools`(`NodeInputKeyEnum.selectedTools = 'agent_selectedTools'`)或「运行应用」节点(appModule)引用工具/子应用,模型落在被引用应用内,单条 Mongo 查询无法跨应用递归。 |

补充限制(UI):下拉候选来自 `useSystemStore` 的 LLM + TTS + ReRank 列表并按 `getMyModelList` 过滤,已从团队配置移除的模型无法在 UI 选中;接口本身仍支持直接传该 id。

## 验证与排查建议

- 单测:`cd projects/app && pnpm test test/api/core/app/list.test.ts`。
- 线上排查某个应用为何被漏筛,可直接看文档里的实际引用位置:

```js
// 以应用名定位,检查模型引用点
db.apps.findOne(
  { name: '目标应用', deleteTime: null },
  { modules: 1, chatConfig: 1 }
)
// 关注:modules[].inputs[key in model/rerankModel/datasetSearchExtensionModel/datasetDeepSearchModel].value
//      modules[].inputs[key=agent_datasetParams].value.rerankModel / .datasetSearchExtensionModel
//      modules[].inputs[key=tts|questionGuide].value.model
//      chatConfig.ttsConfig.model / chatConfig.questionGuide.model
```

- 筛选是团队级的,结果会跨文件夹;列表项只带 `parentId`,前端若不提示「结果来自全部文件夹」,用户容易误判。
- 带 `modelId` 时没有 DB 预截断,命中多少返回多少;若要做分页或条数上限,必须放在内存权限过滤之后,不能恢复 DB 预截断。
- 全量测试与 typecheck / ESLint 由实现方在合并前确认;本文档只记录了单文件 10/10 的本地结果。
