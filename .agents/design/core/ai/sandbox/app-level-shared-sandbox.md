# App 级共享 Sandbox 开发计划

状态：已实现，待完整验收

最后更新：2026-11-18

## 1. 背景与目标

当前普通 App Chat 的物理 Sandbox 身份为 `appId + effectiveUid`，同一用户使用同一 App 的多个 Chat
共享实例。目标是将普通 App Chat 进一步收敛为 `appId` 级共享：不同用户使用同一 App 时连接同一个
Sandbox，仅通过 `sessions/<chatId>` 区分默认工作目录。

本计划按以下产品决策编写：

- 共享范围是**同一个 App 内的全部有效用户**，包括登录、外链和 API 用户；不跨 App、不跨团队。
- 所有普通 App 统一采用应用级共享，不新增按 App 配置的共享开关。
- Workflow Builder 继续保持 `appId + effectiveUid`，Skill Edit 继续保持现有独立身份。
- Session 目录是逻辑工作区边界，不是 Linux 用户、进程、网络或内核级安全边界。
- 目标版本按 `4.17.5` 规划；若发布版本调整，只同步迁移版本字段和目录，稳定任务 ID 不变。

## 2. 非目标与风险边界

- 不引入容器内多 Linux 用户、chroot、每 Session 单独容器或二级虚拟机。
- 不承诺阻止恶意 Shell 命令通过绝对路径、`..`、进程或网络影响其他 Session。
- 不迁移后台进程、shell 环境变量、已安装依赖或内存状态；这些内容由新共享实例重新初始化。
- 不在本次迁移中删除旧用户级 Mongo 记录、S3 归档或 Provider 备份资源。
- 不修改部署相关 `.yml` / `.yaml` 文件。

共享后，不同用户的任务会共用 CPU、内存、磁盘、进程空间和网络。Shell 仍可能绕过应用层文件路径
限制，因此该模式只适合接受这一信任边界的场景，不能宣传为跨用户强隔离。文件 API、IDE 和预览仍需
限制到当前 Session，避免非恶意操作和链接改写造成意外的跨 Session 访问。

## 3. 核心设计

### 3.1 实例身份

增加普通 App 专用的稳定逻辑标识，例如 `APP_SHARED_SANDBOX_USER_ID = 'shared'`，只在
`getSandboxUserId` 的 `sourceType === app` 分支返回该值：

| 场景 | 持久化逻辑身份 | sandboxId |
| --- | --- | --- |
| App Chat | `app + appId + shared` | `app-<hash(appId-shared)>` |
| Workflow Builder | `workflowBuilder + appId + effectiveUid` | 保持现状 |
| Skill Edit | `skillEdit + skillId + skillEdit` | 保持现状 |

约束：

- `chatId` 不参与物理实例 ID；继续只参与 Session 路径。
- JWT、聊天鉴权、审计和计费中的 `uid` 仍是真实有效用户，不得替换为 `shared`。
- `shared` 仅是 Sandbox 存储层的逻辑归属键，不是系统用户，也不参与权限判断。
- 现有 `(sourceType, sourceId, userId)` 唯一索引可以继续使用，不新增或修改 Schema 索引。
- App 删除仍按 `sourceType + sourceId` 清理新共享实例和全部旧用户级实例，不能只查 `shared`。

### 3.2 Session 与共享目录

路径契约保持：

```text
workspaceRoot        = <provider workDirectory>
runtimeSkillsRoot    = <workspaceRoot>/projects
sessionWorkDirectory = <workspaceRoot>/sessions/<chatId>
```

- Shell 默认 cwd、输入文件、文件工具和 Sandbox Editor 默认使用当前 `sessionWorkDirectory`。
- 已发布 Skill、内置 Skill、应用 entrypoint 和镜像源配置属于 App 级共享运行环境。
- 普通 App 的上传、下载、文件工具、HTML 预览和 IDE FS 请求，应用层只允许访问当前 Session；
  绝对路径也必须位于该 Session 内。Workflow Builder 与 Skill Edit 保持原有路径语义。
- 单个 Chat 删除不删除共享 Sandbox；本需求也不新增单 Chat 目录自动清理。

### 3.3 鉴权、Ticket 与预览

所有外部入口继续先调用 `authSandboxRuntimeSession`，再生成应用级 `SandboxClientQuery`：
runtime、keepalive、checkExist、getTicket、verifyTicket、upload、download、preview 不得各自实现
另一套共享 ID 规则。

需要同步收紧两项现有能力：

1. **IDE FS**：Ticket 继续携带真实 `uid` 和 `chatId`；`verifyTicket` 根据 runtime paths 返回本次
   允许的根目录，Proxy 对 FS 请求执行服务端根目录校验，不能只信任前端传入的 Session 路径。
2. **HTML 预览**：新 Preview Session 从“整个 Workspace 的 bearer capability”收敛为“当前 Session
   的只读 capability”。主站保存允许根目录，Proxy 校验 URL 规范路径仍位于该目录；修改 URL 路径不得
   读取其他 Session。历史 Preview token 保持原 TTL 和旧语义，不迁移、不续期。

内部 verify 契约新增字段时使用 Zod/OpenAPI 定义，并由主站和 Proxy 同步升级；滚动升级期间，旧 Proxy
遇到新契约不得放宽校验，新主站不得向尚未支持根目录限制的旧 Proxy 签发共享 App 的 Session 凭证。

### 3.4 初始化与并发

- 生命周期 Lease 的 key 自然变为应用级 `sandboxId`；同一 App 的创建、恢复、升级和删除继续串行。
- `lastActiveAt` 由任意用户的请求或保活刷新；只有整个 App 都闲置后才暂停或归档。
- 任意用户触发恢复或镜像升级时，其他用户看到现有 initializing/upgrading 状态，不得重复创建。
- 现有 init lease 先保证共享 Skill、entrypoint 和镜像源初始化互斥。实施时将 Session 目录创建和输入
  文件注入移到 `sandboxId + chatId` 粒度，避免无关 Session 的文件 I/O 全部被应用级锁串行化。
- 保持 entrypoint 在输入文件注入之后执行的现有顺序；共享 Skill 部署、入口脚本和扫描仍在应用级
  init lease 内完成，不能为了并发引入部分部署或脏扫描。
- 单实例资源限额仍作用于整个 App。首轮不增加用户公平调度，但必须进行并发压测并记录共享 CPU、
  内存、磁盘及工具执行竞争，必要时后续单独增加 App 级执行并发限制。

## 4. 存量实例迁移

### 4.1 迁移契约

新增系统迁移任务：

- ID：`20261118_merge_app_user_sandboxes`，追加到注册表末尾，发布后不改名或复用。
- 版本：`4.17.5`，目录 `projects/app/src/migration/tasks/4175/20261118_merge_app_user_sandboxes/`。
- 模式：`manual: true`，依赖 `20261009_backfill_agent_sandbox_team_id` 成功。
- 恢复策略：按 App 和源实例稳定游标分批断点续跑；批次大小使用系统统一配置。
- 前置条件：管理员确认全部旧版本 App/Pro 节点已下线，旧请求已 draining，新旧 Proxy 支持上述
  Session 根目录契约。不能让旧节点继续写用户级实例。
- 权威数据源：旧用户级 Workspace 的 S3 归档；目标中迁移前已经存在或新产生的内容始终优先。
- 完成条件：每个成功 App 的所有源 Workspace 均已归档并安装，目标已发布为 `stopped`，全局校验
  没有遗漏或仍处于迁移态的目标。坏 App 记录完整错误快照，修复后重试。

手动迁移期间，新节点可以继续服务未迁移 App；某个 App 开始迁移后，其共享目标进入迁移屏障，
该 App 的 Sandbox 请求返回 initializing，不能连接半成品 Workspace。

### 4.2 归并流程

对每个 `sourceType=app` 的 `sourceId` 按稳定顺序执行：

1. 在 Source Mutation Lease 内创建或接管应用级目标，复用现有
   `legacyMigrating + legacyMigration` 作为 Workspace 安装屏障，不新增一套生命周期状态。
   正常运行态必须拒绝该状态；已有 Legacy 迁移语义不得改变。
2. 若目标已由新代码提前创建，先通过标准 archive 保存目标现状。目标现有 `sessions` 是最高优先级，
   后续任何源归档都不得覆盖。
3. 源实例按 `lastActiveAt DESC、_id DESC` 处理，使较新的源先安装；逐个使用标准归档流程保存到
   原 `sandbox/archive/<oldSandboxId>/package.zip`，并保留旧 Mongo 记录与归档。
4. 只安装源归档中的 `sessions/<chatId>`。跳过 `projects` 运行时缓存、临时解压目录和非 Session
   状态；Skill 与 entrypoint 在目标下次运行时按当前 App 配置重新准备。
5. 目标 Session 不存在时使用 staging + rename 原子提交；已存在时递归合并，同名文件及文件/目录
   冲突均保留目标内容。目录存在不能作为安装成功依据，重放必须保持幂等。
6. 全部源安装成功后停止目标计算资源，再一次性发布目标为 `stopped`。停止失败不得提交完成。
7. 源记录保持归档终态和原身份，作为回滚与审计备份；本次任务不物理删除源记录、S3 或归档卷。
8. 每批业务提交后先更新完整失败快照，再保存最小 checkpoint；崩溃后从 checkpoint 和失败记录
   继续，重放归档、安装和停止均不得覆盖目标新内容。

进度阶段设为 `applications`、`workspaces`、`validation`。错误明细只保存 App ID、旧 sandboxId、
阶段和有限原因，不保存文件正文、凭证或完整错误栈。

### 4.3 回滚边界

- 迁移前和目标发布前：可停止任务并恢复源实例；半成品目标保持迁移屏障，不能放行业务。
- 目标发布后、尚无共享新写入：可回滚代码并按旧用户级归档恢复。
- 已产生共享新写入后：不提供自动、无损拆回用户级实例的回滚。必须停止写入并保留目标归档，
  采用前向修复或人工导出 Session；不得宣称直接回滚代码即可保留全部新数据。

## 5. 实施任务

### 任务 1：应用级身份与全入口寻址

修改 `packages/service/core/ai/sandbox/utils/id.ts` 及全局 Sandbox 常量，普通 App 返回稳定
`shared` 逻辑身份。核对 runtime、ToolCall、keepalive、Editor、预览和删除清理全部通过统一 helper
寻址，真实用户鉴权不变，Workflow Builder/Skill Edit 不变。

验收：两个用户使用同一 App 得到相同 sandboxId，不同 App 不同；现有唯一索引无需变化；App 删除
同时覆盖旧、新实例。

### 任务 2：Session 文件边界与 Preview/Proxy 限制

在 `SandboxClient` 增加普通 App 的 Session 内路径解析能力，接入上传、下载、文件工具和预览。
扩展内部 verify 响应与 Preview Redis 上下文，Proxy 强制校验 FS/Preview 根目录。

验收：跨 Session 相对路径、绝对路径、URL 改写、路径穿越和软链接逃逸均被拒绝；历史 token 按原
语义过期；Skill Edit 终端与文件能力不回归。

### 任务 3：共享初始化与 Session 并发

拆分 `ensureAgentSandboxRuntime` 的 Session 文件准备和应用级共享初始化，保持 entrypoint 顺序与
状态去重。核对两个用户同时准备、恢复、升级、保活和归档时只有一个物理生命周期操作。

验收：同 App 并发只创建一个实例；输入文件进入各自 Session；共享 Skill 不重复部署；不同 Session
文件注入不被无关的全局锁阻塞；整个 App 闲置后才回收。

### 任务 4：手动归并迁移

按第 4 节实现迁移目录、注册、i18n、checkpoint、失败快照和完成校验。迁移专属归并代码放在任务
目录，正常运行期复用的归档、生命周期和路径能力保留在 Sandbox 业务模块。

验收：覆盖空目标、已有目标、单用户、多用户、同 chatId 冲突、失败重试、checkpoint 前后崩溃、
源归档保留、目标停止发布和幂等重跑；任何失败都不能发布半成品目标。

### 任务 5：文档与兼容说明

更新 `.agents/design/core/ai/sandbox/{index.md,user-level-sandbox.md}`，将本方案标为普通 App 的
新边界，并同步中英文 AgentV2 虚拟机文档及内部 API 注释。明确共享进程/Shell 风险、迁移前置和
不可自动拆分回滚的边界。文档翻译按项目 `doc-i18n` 流程执行。

## 6. 验证计划

只运行覆盖改动的局部测试，用户最终验收前不主动运行全量测试。

### 单元与 API 测试

- 身份稳定性、真实 uid 与共享归属键分离、App 删除清理范围。
- Session 路径、上传/下载、IDE FS、Preview URL 和跨 Session 拒绝。
- init/lifecycle lease、lastActiveAt、停止/归档/恢复及并发竞争。
- 迁移幂等、断点、失败快照、目标内容优先、完成校验和回滚屏障。
- 旧 Preview token、Workflow Builder、Skill Edit 的兼容测试。

### 集成与端到端验收

分别在 OpenSandbox 和 Sealos Devbox 验证：

1. 用户 A、B 使用同一 App 发起真实 Agent 请求，只出现一个共享物理实例。
2. A、B 的默认 cwd 和上传文件分别位于各自 `sessions/<chatId>`，IDE/下载/预览不能越界。
3. 两边并发执行 Shell 和文件工具，检查初始化竞争、资源争用及错误隔离。
4. A 活跃时 B 的实例不被闲置回收；停止、归档后任一用户均可唤醒同一个实例。
5. 执行手动迁移后，历史 Session 文件存在且目标新文件未被覆盖；失败 App 不开放半成品环境。
6. `pnpm --filter @fastgpt/app typecheck`、相关局部 Vitest、Proxy Rust 测试和 `git diff --check`
   全部通过。

## 7. TODO

- [x] 任务 1：应用级身份与全入口寻址。
- [x] 任务 2：Session 文件边界与 Preview/Proxy 限制。
- [x] 任务 3：共享初始化与 Session 并发。
- [x] 任务 4：手动归并迁移。
- [x] 任务 5：设计、使用中英文文档和 API 注释同步。
- [ ] OpenSandbox / Sealos Devbox 集成与双用户端到端验收。
