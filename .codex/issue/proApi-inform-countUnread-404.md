# proApi/support/user/inform/countUnread 404 问题分析

## 现象

生产环境控制台每 30 秒报一次：

```
GET https://wsxf.nc-xinfang.gov.cn:20000/chagent/api/proApi/support/user/inform/countUnread 404 (Not Found)
error-> 请求错误 AxiosError: Request failed with status code 404
```

## 调用链

1. `projects/app/src/components/Layout/index.tsx:91-94`
   每个已登录页面通过 react-query 轮询 `getUnreadCount`，`refetchInterval: 30000`（与堆栈中的 setInterval 吻合），
   启用条件：`!!userInfo && !!feConfigs.isPlus`。
2. `projects/app/src/web/support/user/inform/api.ts:9-13`
   请求 `GET /proApi/support/user/inform/countUnread`。
3. `projects/app/src/pages/api/proApi/[...path].ts`
   开源版应用中 `/api/proApi/*` 是 catch-all 代理，转发到 `${PRO_URL}/api/*`（商业版后端）。
   - `FastGPTProUrl = process.env.PRO_URL ? ${PRO_URL}/api : ''`（`packages/service/common/system/constants.ts:1`）
   - 若 `PRO_URL` 未配置会返回 500（"未配置商业版链接"），而不是 404。
4. `isPlus: !!licenseData`（`projects/app/src/service/common/system/index.ts:158`），
   即只有配置了商业版且 license 有效时前端才会发起该轮询。

## 结论（2026-10-12 更新：pro 子路径场景）

**根因：`PRO_URL` 带子路径 `/fastaipro` 时，proApi 代理会把子路径丢掉。**

`projects/app/src/pages/api/proApi/[...path].ts:18`：

```ts
const targetUrl = new URL(requestPath, FastGPTProUrl);
```

`requestPath` 以 `/` 开头（如 `/api/support/user/inform/countUnread`），按 URL 规范它属于
绝对路径，会**整体替换** base URL 的 path：

```js
new URL('/api/support/user/inform/countUnread', 'https://host:20000/fastaipro/api').href
// 实际:   'https://host:20000/api/support/user/inform/countUnread'   ← /fastaipro 被丢弃
// 期望:   'https://host:20000/fastaipro/api/support/user/inform/countUnread'
```

所以请求打到了不带 `/fastaipro` 的地址，网关/pro 服务上没有该路由 → 404。
没加 `/fastaipro` 之前 PRO_URL 没有子路径，拼接结果恰好正确，所以"之前是正常的"。

上游 main 分支同样存在该限制：`buildSameOriginUrl`
（`packages/service/common/security/network.ts:46`）内部也是 `new URL(path, base)`，
只加了 origin 校验，不保留 base 的子路径。**即 FastGPT 全版本均不支持带子路径的 PRO_URL。**

license 不受影响的原因：`licenseData` 来自数据库（`getFastGPTConfigFromDB`），
不走 proApi 代理，所以 `isPlus=true` 照常，轮询照常发起，于是每 30 秒一个 404。

## 排查验证步骤

1. 确认环境变量：`docker exec <fastgpt容器> printenv PRO_URL`，预期含 `/fastaipro`。
2. 对比两个地址（复现代理行为）：
   - `curl -ik "https://wsxf.nc-xinfang.gov.cn:20000/fastaipro/api/support/user/inform/countUnread"`
     → 应为 401/200（证明路由存在于 pro）
   - `curl -ik "https://wsxf.nc-xinfang.gov.cn:20000/api/support/user/inform/countUnread"`
     → 404（代理实际请求的地址）
3. 看 pro 服务（或网关）日志：收到的请求路径里没有 `/fastaipro` 前缀。

## 修复方案

| 方案 | 做法 | 前提/影响 |
|---|---|---|
| A（运维侧，无需改代码） | `PRO_URL` 直接指向 pro 服务的内部地址、不带子路径（如 `http://fastgpt-pro:3000`）。proApi 是服务端到服务端的调用，不需要走浏览器网关的 `/fastaipro` 前缀 | pro 应用本身没有内置 basePath 时才可行 |
| B（代码侧，ch 分支修复） | 修改 `[...path].ts` 拼接逻辑，保留 base 子路径：`new URL(`${FastGPTProUrl}/${path.join('/')}?${query}`)` | 重新打包镜像；pro 应用自身带 basePath 时必须用这个 |
| C（消除噪音） | 前端 `getUnreadCount` catch 404 返回空 | 不解决根本问题 |

---

## 历史分析（首次排查）
