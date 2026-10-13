# 全部应用调用量统计看板

## 1. 需求分析

### 背景

目前查看应用调用量（对话次数）只能进入每个应用的详情页 → 对话日志 Tab 单独查看，无法横向对比所有应用的调用情况。

### 需求

提供一张**统计表**：在**一定时间范围内**，展示**每个应用的对话次数**，支持横向对比。

### 需求确认（默认决策，可在评审时调整）

| 问题 | 决策 |
| --- | --- |
| "对话次数"口径 | 按 `chats` 集合文档数计（一行 = 一个会话），与现有"对话日志列表 total"口径一致 |
| 时间字段 | `updateTime`（与现有日志列表查询一致，命中索引） |
| 权限 | 团队管理者/Owner 可见（`TeamManagePermissionVal`），与 hidden 应用日志的权限口径一致 |
| 统计范围 | 团队内全部应用；排除 folder 类型与已删除应用 |
| 入口位置 | 应用列表页 `/dashboard/agent` 工具栏新增"调用量统计"按钮，弹抽屉展示 |
| 附加列 | 报错次数、使用人数（聚合时顺带计算，成本低、价值高） |

## 2. 技术调研结论

### 现有实现

- 单应用日志：`projects/app/src/pages/api/core/app/logs/list.ts`（POST `/core/app/logs/list`），`authApp` 校验 `AppReadChatLogPerVal`，`MongoChat` 按 `appId + updateTime` 聚合。
- 单应用"数据看板"图表走 `/proApi`（商业版），本仓库无实现。
- 团队级用量页（`account/usage`）统计的是**积分消耗**，也走 `/proApi`，不可复用。
- **结论：跨应用对话次数统计需新建开源 API。**

### 数据模型

- `chats` 集合（`packages/service/core/chat/chatSchema.ts`）：`teamId`、`appId`(ObjectId)、`updateTime`、`source`、`errorCount`、`tmbId`、`outLinkUid`。
- 可用索引：`{ teamId: 1, updateTime: -1 }` —— 团队级按时间范围聚合正好命中。

### 可复用的前端组件

- 时间范围选择：`@fastgpt/web/components/common/DateRangePicker`（`DateRangeType { from, to }`，`onSuccess(date)`）。
- 来源多选：`@fastgpt/web/components/common/MySelect/MultipleSelect` 的 `useMultipleSelect` + `ChatSourceEnum`。
- 表格：Chakra UI `Table`；抽屉：`MyDrawer`（`@fastgpt/web/components/common/MyDrawer`）。
- 权限判断（前端显隐按钮）：`useUserStore().userInfo?.team.permission.hasManagePer`（基类 `Permission.hasManagePer`，见 `packages/global/support/permission/controller.ts:37`）。

## 3. 开发设计

### 3.1 OpenAPI 契约（`packages/global/openapi/core/app/log/api.ts`）

新增：

```ts
// Get team app chat stats
export const GetTeamAppChatStatsBodySchema = z.object({
  dateStart: z.union([z.string(), z.date()]),
  dateEnd: z.union([z.string(), z.date()]),
  sources: z.array(z.nativeEnum(ChatSourceEnum)).optional()
});
export type GetTeamAppChatStatsBody = z.infer<typeof GetTeamAppChatStatsBodySchema>;

export const TeamAppChatStatsItemSchema = z.object({
  appId: z.string(),
  name: z.string(),
  avatar: z.string(),
  type: z.string(),
  chatCount: z.number(),   // 对话次数（chats 文档数）
  errorCount: z.number(),  // 报错次数
  userCount: z.number()    // 使用人数（tmbId + outLinkUid 去重）
});
export type TeamAppChatStatsItemType = z.infer<typeof TeamAppChatStatsItemSchema>;

export const GetTeamAppChatStatsResponseSchema = z.object({
  list: z.array(TeamAppChatStatsItemSchema),
  totalChatCount: z.number()
});
export type GetTeamAppChatStatsResponse = z.infer<typeof GetTeamAppChatStatsResponseSchema>;
```

`packages/global/openapi/core/app/log/index.ts` 注册路径 `POST /core/app/logs/teamStats`，tag `TagsMap.appLog`。

### 3.2 API 路由（`projects/app/src/pages/api/core/app/logs/teamStats.ts`）

参照 `getUsers.ts` 的写法：

1. `GetTeamAppChatStatsBodySchema.parse(req.body)` 解析参数。
2. `authUserPer({ req, authToken: true, per: TeamManagePermissionVal })` 鉴权（`@fastgpt/service/support/permission/user/auth` + `@fastgpt/global/support/permission/user/constant`）。
3. `MongoChat.aggregate`（`readFromSecondary`）：

```ts
[
  { $match: {
      teamId: new Types.ObjectId(teamId),
      updateTime: { $gte: new Date(dateStart), $lte: new Date(dateEnd) },
      ...(sources?.length && { source: { $in: sources } })
  } },
  { $group: {
      _id: '$appId',
      chatCount: { $sum: 1 },
      errorCount: { $sum: { $ifNull: ['$errorCount', 0] } },
      tmbIds: { $addToSet: '$tmbId' },
      outLinkUids: { $addToSet: '$outLinkUid' }
  } },
  { $lookup: { from: 'apps', localField: '_id', foreignField: '_id', as: 'app' } },
  { $unwind: '$app' },
  { $match: { 'app.type': { $ne: AppTypeEnum.folder } } },
  { $project: {
      appId: '$_id', name: '$app.name', avatar: '$app.avatar', type: '$app.type',
      chatCount: 1, errorCount: 1,
      userCount: { $size: { $setUnion: ['$tmbIds', '$outLinkUids'] } }
  } },
  { $sort: { chatCount: -1 } }
]
```

4. 返回 `{ list, totalChatCount }`。

### 3.3 前端 API（`projects/app/src/web/core/app/api/log.ts`）

```ts
export const getTeamAppChatStats = (data: GetTeamAppChatStatsBody) =>
  POST<GetTeamAppChatStatsResponse>('/core/app/logs/teamStats', data, { maxQuantity: 1 });
```

### 3.4 前端 UI

- 新组件：`projects/app/src/pageComponents/dashboard/agent/ChatStatsDrawer/index.tsx`
  - `MyDrawer` 右侧抽屉，标题"全部应用调用量"。
  - 顶部：`DateRangePicker`（默认近 7 天，参照 `Logs/index.tsx:26-29`）+ 来源多选（`useMultipleSelect(ChatSourceEnum)`）。
  - 表格列：应用（头像 + 名称）、类型、对话次数、报错次数、使用人数；按对话次数降序；底部汇总行显示 `totalChatCount`。
  - 加载/空态参照现有表格组件写法；`useRequest` 拉数据，时间/来源变化时重新请求。
- 入口：`projects/app/src/pages/dashboard/agent/index.tsx` 工具栏（`ModelFilterSelect` 旁），`userInfo?.team.permission.hasManagePer` 时显示"调用量统计"按钮（`MyIcon` + `Button variant="grayBase"`），点击打开抽屉。
- 无需新增页面路由，`getServerSideProps` 已有 `app` namespace。

### 3.5 i18n（`packages/web/i18n/{zh-CN,zh-Hant,en}/app.json`）

新增 keys（三个语言文件都加）：

| key | zh-CN | zh-Hant | en |
| --- | --- | --- | --- |
| `team_chat_stats` | 调用量统计 | 呼叫量統計 | Call Statistics |
| `team_chat_stats_title` | 全部应用调用量 | 全部應用呼叫量 | All App Call Volume |
| `team_chat_stats_total` | 合计 | 合計 | Total |
| `team_chat_stats_user_count` | 使用人数 | 使用人數 | Users |
| `logs_error_chat_count`（若已存在则复用） | 报错次数 | 報錯次數 | Errors |

现有可复用 key：`logs_chat_count`（会话次数）。先检查是否已有对应 key，避免重复。

## 4. 测试与验证

- `pnpm lint` 通过。
- 局部测试：检查 `test/cases` 下是否有 logs 相关测试可参照/补充；无则至少通过 lint + 构建检查（`cd projects/app && pnpm build` 如耗时过长可只做 tsc 检查）。
- 手动验证路径：启动 dev → 应用列表页 → 调用量统计 → 切换时间范围 → 表格数据与单应用日志 total 一致。

## 5. TODO

- [x] 1. OpenAPI 契约：`packages/global/openapi/core/app/log/api.ts` + `index.ts` 新增 teamStats
- [x] 2. API 路由：`projects/app/src/pages/api/core/app/logs/teamStats.ts`
- [x] 3. 前端 API 封装：`projects/app/src/web/core/app/api/log.ts`
- [x] 4. i18n：三个语言 `app.json` 新增 keys
- [x] 5. 抽屉组件：`projects/app/src/pageComponents/dashboard/agent/ChatStatsDrawer/index.tsx`
- [x] 6. 入口按钮：`projects/app/src/pages/dashboard/agent/index.tsx`
- [x] 7. 运行 `pnpm lint` 与相关测试，确认通过

## 6. 实现记录

### 改动文件

**新建**
- `projects/app/src/pages/api/core/app/logs/teamStats.ts` — 团队应用调用量统计 API（`authUserPer` + `TeamManagePermissionVal` 鉴权，`MongoChat.aggregate` 走 `readFromSecondary`）
- `projects/app/src/pageComponents/dashboard/agent/ChatStatsDrawer/index.tsx` — 调用量统计抽屉（`MyRightDrawer` + `DateRangePicker` + 来源 `MultipleSelect` + Chakra Table）

**修改**
- `packages/global/openapi/core/app/log/api.ts` — 新增 `GetTeamAppChatStatsBodySchema`、`TeamAppChatStatsItemSchema`、`GetTeamAppChatStatsResponseSchema` 及类型
- `packages/global/openapi/core/app/log/index.ts` — 注册 `POST /core/app/logs/teamStats`（tag `TagsMap.appLog`）
- `projects/app/src/web/core/app/api/log.ts` — 新增 `getTeamAppChatStats` 封装（`maxQuantity: 1`）
- `packages/web/i18n/zh-CN/app.json`、`zh-Hant/app.json`、`en/app.json` — 新增 `team_chat_stats`、`team_chat_stats_title`、`team_chat_stats_total`、`team_chat_stats_user_count` 4 个 key
- `projects/app/src/pages/dashboard/agent/index.tsx` — 工具栏新增"调用量统计"按钮（`hasManagePer` 时渲染，`chart` 图标 + `variant="grayBase"`），`dynamic` 引入抽屉

### 与设计的偏差

1. **已删除应用排除**：设计管道只排除 folder 类型；实现按需求补充 `'app.deleteTime': null`（已确认软删字段即 `deleteTime`，见 `packages/service/core/app/schema.ts`）。
2. **userCount 空值处理**：设计提示用 `$ifNull` 兜底；实现改为 `$filter` 过滤 `$setUnion` 结果中的 `null`（`$addToSet` 对缺失的 `outLinkUid` 可能混入 null，`$ifNull` 转空串会产生系统性 +1 虚计，`$filter` 同样简单且计数准确）。
3. **集合名**：`$lookup.from` 使用 `AppCollectionName` 常量（值即 `'apps'`）替代硬编码字符串。
4. **i18n key 复用**：报错次数列复用已有 `logs_error_count`（报错数量），未新增 `logs_error_chat_count`；"名称"/"类型"列表头复用 `common:Name`、`common:support.standard.type`；空态复用 `logs_empty`。
5. **抽屉组件**：设计写 `MyDrawer`，实际组件为 `@fastgpt/web/components/common/MyDrawer/MyRightDrawer`（仓库现行用法）。
6. **useRequest 加载态**：返回值字段为 `loading`（ahooks），非 `isLoading`。

### 验证结果

- `pnpm lint`（根目录）：本次改动文件 0 error 0 warning；仓库存量 1 error（`projects/app/src/pageComponents/app/detail/Publish/Wechat/QRLoginModal.tsx:129` 引用了不存在的 eslint 规则 `react-hooks/set-state-in-effect`，文件未改动，属存量问题）+ 69 个存量 warning。
- `cd projects/app && pnpm typecheck`（`tsc --noEmit --pretty`）：通过，exit 0。
- `packages/global` 独立 `tsc --noEmit`：240 个存量错误全部位于 `test/` 目录，`openapi/` 下 0 错误。
- `test/cases` 下无 logs/teamStats 相关测试，按约定跳过。
- i18n 三个 `app.json` 均通过 JSON 合法性校验。

## 7. 迭代记录

### v2(2026-10-13):行跳转 + 数据导出

1. **行点击跳转**：表格行 `onClick` → `router.push('/app/detail?appId=' + appId)`(复用 `dashboard/agent/List.tsx` 的跳转路径),行加 `cursor: pointer`。
2. **数据导出**:筛选栏右侧新增导出按钮(`common:Export` + `common/download` 图标,空数据禁用),前端直接基于已加载的全量聚合数据生成 CSV(无需新 API):
   - 列:名称、类型(`appTypeTagMap` label 经 `t()` 翻译)、会话次数、报错数量、使用人数;末尾追加合计行。
   - `\uFEFF` BOM 保证 Excel 打开中文不乱码;单元格按 CSV 规范转义(逗号/引号/换行)。
   - 文件名:`全部应用调用量_yyyyMMdd-yyyyMMdd.csv`(随当前时间范围)。
   - 改动文件:仅 `projects/app/src/pageComponents/dashboard/agent/ChatStatsDrawer/index.tsx`,复用 `common:Export` 等已有 i18n key,无新增翻译。
   - 验证:`projects/app` typecheck 通过,eslint 0 error。
