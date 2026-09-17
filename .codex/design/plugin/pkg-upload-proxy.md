# 插件包(.pkg)上传后端中转方案

## 背景

「导入/更新插件」弹窗(`projects/app/src/pageComponents/config/ImportPluginModal.tsx`)上传 .pkg 文件的链路:

1. 前端调用 `GET /api/core/plugin/admin/pkg/presign` → 后端转发给外部 fastgpt-plugin 服务 → 返回插件服务内部 MinIO 的**直连预签名 URL**(`postURL`);
2. 浏览器直接 `PUT` 文件到 MinIO(如 `http://192.168.1.206:9002/...`);
3. 前端调用 `GET /api/core/plugin/admin/pkg/parse?objectName=...`,插件服务从 MinIO 读取并解析。

问题:真实生产环境中,浏览器无法直连内网 MinIO 文件服务器,导致上传失败。

约束:插件 SDK(`@fastgpt-sdk/plugin@0.6.0`)只提供 `getToolUploadUrl` / `parseUploadedTool` / `confirmToolUpload`,没有"直接提交文件内容"的接口,无法完全绕开 MinIO。

## 方案(已与用户确认)

新增**后端中转上传接口**,浏览器只与 FastGPT 主服务通信(同域名),由服务端完成到 MinIO 的上传:

```
浏览器 --PUT 文件--> /api/core/plugin/admin/pkg/upload?filename=xx.pkg
                        │
                        ├─ authSystemAdmin 鉴权
                        ├─ 服务端调用 pluginClient.getToolUploadUrl(filename) 获取预签名 URL
                        ├─ 以流式方式(bodyParser: false,流透传)将请求体 PUT 到 MinIO postURL
                        └─ 返回 { objectName }
浏览器 --GET--> /api/core/plugin/admin/pkg/parse?objectName=...(流程不变)
```

前提:FastGPT 服务端网络可达 MinIO(通常同内网部署,可达)。

参考实现:`projects/app/src/pages/api/system/file/upload/[token].ts`(`bodyParser: false` + 流式上传)。

旧接口 `/core/plugin/admin/pkg/presign` 保留(OpenAPI 公开契约兼容),前端不再调用。

## 变更点

1. `packages/global/openapi/core/plugin/admin/api.ts`:新增 `UploadPkgPluginQuerySchema`({ filename })、`UploadPkgPluginResponseSchema`({ objectName })。
2. `packages/global/openapi/core/plugin/admin/index.ts`:注册 `PUT /core/plugin/admin/pkg/upload` 路由契约。
3. 新增 `projects/app/src/pages/api/core/plugin/admin/pkg/upload.ts`:
   - 仅允许 PUT;`authSystemAdmin` 鉴权;`bodyParser: false`;
   - 调 `pluginClient.getToolUploadUrl(filename)` 获取 `postURL/formData/objectName`;
   - axios PUT 流式转发 `req` 到 `postURL`,透传 `formData` 头与 `content-length`,`maxBodyLength/maxContentLength: Infinity`;
   - 返回 `{ objectName }`。
4. `projects/app/src/web/core/plugin/admin/api.ts`:新增 `uploadPkgPluginFile`,PUT 文件到中转接口(filename 走 query,文件为 body,timeout 放宽到 5 分钟)。
5. `projects/app/src/pageComponents/config/ImportPluginModal.tsx`:`uploadAndParseFile` 改为单次中转上传拿 `objectName`,再 parse;移除 `putFileToS3` / `getPkgPluginUploadURL` 的使用。

## TODO

- [x] 1. openapi 契约:新增 Upload schema/type 与路由注册
- [x] 2. 新增后端中转上传 API 路由 upload.ts
- [x] 3. 前端 api.ts 新增 uploadPkgPluginFile
- [x] 4. ImportPluginModal.tsx 改用中转上传
- [x] 5. lint + 局部验证(eslint 通过;projects/app tsc --noEmit 通过;无该流程相关测试用例)
- [x] 6. Bug 修复:`web/common/api/request.ts` 的"去空"循环对 File body 会改写只读原型属性
  `lastModifiedDate`(返回 Date,触发 `val instanceof Date` 分支)导致
  `TypeError: Cannot set property lastModifiedDate of #<File> which has only a getter`,
  请求未发出即被 catch。修复:仅对普通对象/数组执行去空,File/Blob/FormData 直接透传。
  已通过真实浏览器(CDP)全链路验证:upload → parse → 页面显示"已上传"。
