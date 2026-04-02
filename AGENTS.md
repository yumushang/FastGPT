# FastGPT 项目开发指南

## 项目概述

FastGPT 是一个 AI Agent 构建平台，提供开箱即用的数据处理、模型调用等能力，同时可以通过 Flow 可视化进行工作流编排，从而实现复杂的应用场景。

**官方文档**: https://doc.fastgpt.io/docs/introduction  
**在线使用**: https://fastgpt.io/

## 技术栈

- **前端框架**: Next.js 14.2.x + React 18.3.x + TypeScript 5.x
- **UI 组件库**: Chakra UI 2.10.x
- **状态管理**: Zustand + React Context
- **后端服务**: Next.js API Routes (Node.js)
- **数据库**: MongoDB (主数据库) + PostgreSQL/Milvus/OceanBase (向量数据库)
- **缓存**: Redis
- **对象存储**: MinIO (S3 兼容)
- **任务队列**: BullMQ
- **沙箱执行**: isolated-vm (Node.js VM)

## 项目结构

本项目使用 pnpm workspace 管理的 monorepo 架构：

```
fastgpt/
├── packages/                    # 共享包
│   ├── global/                  # 全局类型定义和常量
│   │   ├── common/              # 通用工具类型
│   │   └── core/                # 核心业务类型 (AI/应用/数据集/工作流)
│   ├── service/                 # 服务端共享代码
│   │   ├── common/              # 通用服务 (MongoDB/Redis/文件/S3)
│   │   └── core/                # 核心业务逻辑
│   └── web/                     # 前端共享组件和 hooks
│       ├── components/          # 通用 UI 组件
│       ├── hooks/               # React Hooks
│       └── i18n/                # 国际化资源
│
├── projects/                    # 主项目
│   ├── app/                     # FastGPT 核心应用
│   ├── sandbox/                 # 代码沙箱 (NestJS + isolated-vm)
│   ├── mcp_server/              # MCP (Model Context Protocol) 服务
│   └── marketplace/             # 插件市场
│
├── plugins/                     # 辅助插件
│   ├── model/                   # 私有化模型
│   └── webcrawler/              # 网络爬虫
│
├── test/                        # 测试配置和用例
├── deploy/                      # 部署配置
└── document/                    # 文档
```

## 开发环境要求

- **Node.js**: >= 20.x
- **pnpm**: 9.15.9 (推荐使用)
- **Docker**: 用于部署和运行依赖服务
- **Make**: 用于执行 Makefile 命令 (推荐安装)

## 开发命令

### 安装依赖

```bash
# 安装所有依赖
pnpm i

# 如果 Node 版本 >= 20，需要使用 --no-node-snapshot 参数
NODE_OPTIONS=--no-node-snapshot pnpm i

# 给脚本添加执行权限 (Linux/Mac)
chmod -R +x ./scripts/
```

### 开发模式

```bash
# 方式 1: 直接进入项目目录
cd projects/app
pnpm dev

# 方式 2: 使用 Make (推荐)
make dev name=app
```

### 代码格式化

```bash
# 格式化 TypeScript/TSX/SCSS 代码
pnpm format-code

# 格式化文档
pnpm format-doc

# 代码检查与修复
pnpm lint
```

### 构建

```bash
# 不使用 Make
cd projects/app
pnpm build

# 使用 Make 构建 Docker 镜像
make build name=app image=your-registry/fastgpt:v4.x.x

# 使用代理构建 (taobao 镜像)
make build name=app image=your-registry/fastgpt:v4.x.x proxy=taobao
```

## 代码规范

### 代码风格

本项目使用以下工具保证代码质量：

- **ESLint**: 代码检查 (配置在 `.eslintrc.json`)
  - 使用 `@typescript-eslint` 插件
  - 规则继承 `next/core-web-vitals`
  - 强制使用 `type-imports` 导入类型

- **Prettier**: 代码格式化 (配置在 `.prettierrc.js`)
  - 单引号
  - 无尾随逗号
  - 每行最大 100 字符
  - 使用 2 空格缩进

### Git Hooks

使用 Husky + lint-staged 在提交前自动格式化代码：

```bash
pnpm prepare  # 初始化 husky
```

### 模块导入规范

```typescript
// 推荐: 类型导入使用 type 关键字
import type { AppType } from '@fastgpt/global/core/app/type.d';
import { getAppDetail } from '@fastgpt/service/core/app/controller';

// 路径别名
@fastgpt/*     -> packages/*
@/             -> projects/app/src/
@test          -> test/*
```

## 测试

### 测试框架

- **Vitest**: 单元测试和集成测试
- **@vitest/coverage-v8**: 代码覆盖率
- **mongodb-memory-server**: 内存 MongoDB 测试

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test:workflow

# 生成覆盖率报告
# 报告位置: coverage/index.html
```

### 测试配置

测试配置文件: `vitest.config.mts`

- 使用 `mongodb-memory-server` 创建隔离的测试数据库
- 每个测试文件运行后自动清理数据库
- 测试超时: 20 秒

### 测试文件位置

```
test/
├── cases/              # 测试用例
├── datas/              # 测试数据
├── mocks/              # Mock 模块
├── setup.ts            # 测试初始化
├── globalSetup.ts      # 全局初始化
└── utils/              # 测试工具
```

## 国际化 (i18n)

### 支持语言

- `en` - 英文
- `zh-CN` - 简体中文
- `zh-Hant` - 繁体中文

### 翻译文件位置

```
packages/web/i18n/
├── en/                 # 英文翻译
├── zh-CN/              # 简体中文翻译
└── zh-Hant/            # 繁体中文翻译
```

### 使用方式

**服务端渲染 (getServerSideProps)**:
```typescript
export async function getServerSideProps(context: any) {
  return {
    props: {
      ...(await serverSideTranslations(context.locale, ['app', 'common']))
    }
  };
}
```

**客户端使用**:
```typescript
import { useTranslation } from 'next-i18next';

const Component = () => {
  const { t } = useTranslation();
  return <div>{t('common:close')}</div>;
};
```

**静态内容翻译**:
```typescript
import { i18nT } from '@fastgpt/web/i18n/utils';

const content = {
  name: i18nT('app:template.simple_robot')
};
```

### 翻译键规范

- 使用 `namespace:key` 格式
- 键名使用小写字母和下划线，如 `common.close`

## 环境配置

### 必需环境变量

复制 `projects/app/.env.template` 到 `projects/app/.env.local` 并配置：

```bash
# 数据库
MONGODB_URI="mongodb://username:password@localhost:27017/fastgpt?authSource=admin"
MONGODB_LOG_URI="mongodb://username:password@localhost:27017/fastgpt?authSource=admin"

# Redis
REDIS_URL=redis://default:mypassword@127.0.0.1:6379

# 向量数据库 (优先级: pg > oceanbase > milvus)
PG_URL=postgresql://username:password@localhost:5432/postgres

# S3 存储
S3_ENDPOINT=localhost
S3_PORT=9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# 默认密码
DEFAULT_ROOT_PSW=123456
```

### 配置说明

详细配置说明请参考: https://doc.fastgpt.io/docs/introduction/development/configuration/

## 部署

### Docker 部署

FastGPT 提供多种部署方式：

1. **标准部署**: 使用 `deploy/docker/` 下的配置
2. **Sealos 一键部署**: https://doc.fastgpt.io/docs/introduction/development/sealos/
3. **Helm 部署**: `deploy/helm/`

### 生成部署配置

```bash
# 更新 args.json 版本号后执行
pnpm gen:deploy
```

### 构建 Worker

```bash
cd projects/app
pnpm build:workers

# 监听模式
pnpm build:workers:watch
```

## 数据库架构

### MongoDB 集合

- `apps` - 应用数据
- `datasets` - 数据集
- `dataset.collections` - 数据集集合
- `dataset.datas` - 数据集内容块
- `dataset.trainings` - 训练任务
- `chats` - 对话记录
- `chatitems` - 对话消息
- `users` - 用户
- `teams` - 团队
- `plugins` - 插件

### 向量数据库

支持 PostgreSQL (pgvector)、Milvus、OceanBase 三种向量数据库。

## 工作流系统

FastGPT 核心功能是可视化工作流编排：

### 工作流节点类型

- **基础节点**: workflowStart, emptyNode, comment
- **AI 节点**: aiChat, classifyQuestion, contextExtract
- **工具节点**: http468, readFiles, textEditor, codeSandbox
- **数据集节点**: datasetSearch, datasetConcat
- **流程控制**: ifElse, loop, variableUpdate
- **交互节点**: formInput, userSelect
- **插件节点**: runPlugin, runTool, stopTool

### 工作流定义

工作流模板定义在 `packages/global/core/workflow/template/system/` 目录。

## 安全注意事项

1. **环境变量安全**
   - 生产环境务必修改默认密钥
   - 使用强密码
   - 保护好 `ROOT_KEY` 和 `AES256_SECRET_KEY`

2. **IP 限制**
   - 可启用 `USE_IP_LIMIT=true` 开启 IP 限流
   - 通过 `ALLOWED_ORIGINS` 配置跨域白名单

3. **文件安全**
   - 文件存储建议使用独立的域名 (`FILE_DOMAIN`)
   - 配置 `CHECK_INTERNAL_IP=true` 防止 SSRF 攻击

4. **沙箱安全**
   - 代码执行在独立的 sandbox 服务中运行
   - 使用 isolated-vm 隔离用户代码

5. **密码策略**
   - `PASSWORD_LOGIN_LOCK_SECONDS` - 登录失败锁定时间
   - `PASSWORD_EXPIRED_MONTH` - 密码过期月份
   - `MAX_LOGIN_SESSION` - 最大登录客户端数量

## 许可证

FastGPT 基于 Apache License 2.0 开源，附加以下条件：

1. 允许作为后台服务直接商用，但不允许提供多租户 SaaS 服务
2. 未经商业授权，不得移除或修改 FastGPT 控制台中的 LOGO 或版权信息

详细请查看 [LICENSE](./LICENSE)

## 相关项目

- [FastGPT-plugin](https://github.com/labring/fastgpt-plugin)
- [Laf](https://github.com/labring/laf) - 3分钟快速接入三方应用
- [Sealos](https://github.com/labring/sealos) - 快速部署集群应用
- [One API](https://github.com/songquanpeng/one-api) - 多模型管理

## 社区与支持

- 官方文档: https://doc.fastgpt.io/
- GitHub Issues: https://github.com/labring/FastGPT/issues
- 飞书话题群: 见 README.md
