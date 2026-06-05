# Kikoeru2WebDav

把 asmr-200 / asmr.one 的作品、热门列表和个人推荐，映射成一个可以被 rclone、Windows 资源管理器、macOS Finder 等客户端挂载的只读 WebDAV 文件系统。

这个项目运行在 Cloudflare Workers 上。它不会把音频、图片或压缩包保存到 Cloudflare；Worker 只负责生成目录、处理 WebDAV 协议、缓存必要的 API 元数据，并在客户端读取文件时把远端媒体响应流式转发回来。

## 它能做什么

- 把任意 asmr-200 作品 id 映射成 WebDAV 目录。
- 支持 `RJ01489611` 和 `01489611` 两种作品 id 写法。
- 访问 `/popular/` 时拉取热门作品列表，并把每个作品显示成目录。
- 访问 `/recommend/` 时使用 asmr.one 登录态拉取个人推荐作品。
- 根目录 `/` 自动显示入口目录：
  - 未登录或 `guest` 访客只显示 `popular/`。
  - 非 guest 的 Basic Auth 用户会额外看到 `recommend/`。
- 用 WebDAV Basic Auth 的用户名和密码登录 asmr.one，并把 JWT token 缓存在 Cloudflare KV。
- 支持 guest 匿名模式：用户名 `guest`，密码随意，可以浏览不需要登录的接口。
- 支持 WebDAV `PROPFIND`、`GET`、`HEAD`、`OPTIONS`。
- 支持浏览器 HTML 目录页，也支持标准 WebDAV 客户端。
- 支持 Range 请求，适合音频文件拖动播放、断点读取和媒体客户端扫描。
- 支持手动追加远程文件 URL，混入自定义目录。
- 支持通过 `REMOTE_BASE_URL` 把一批远程路径映射成只读文件树。
- 目录和文件名保留日文、中文等 Unicode 字符，并在 WebDAV href 中正确编码。
- 只读保护：所有写入类 WebDAV 方法都会返回 `403`。

## 工作方式

Kikoeru2WebDav 把不同来源的数据统一转换成内部的 WebDAV manifest：

```text
asmr track API
popular API
recommend API
manual URLs
REMOTE_BASE_URL
        │
        ▼
  files / dirs manifest
        │
        ▼
WebDAV XML / HTML index / streamed file proxy
```

客户端看到的是目录和文件；Worker 背后按需请求 asmr-200 API。真正读取媒体文件时，Worker 会转发到 API 返回的 `mediaDownloadUrl`、`mediaStreamUrl` 或其他配置的 URL 字段。

## 路由总览

| 路径 | 能力 | 是否需要 asmr.one 登录 |
| --- | --- | --- |
| `/` | 入口目录，显示 `popular/`，登录后显示 `recommend/` | 否 |
| `/popular/` | 热门作品目录 | 否 |
| `/popular/RJxxxxxxx/` | 展开热门作品的文件树 | 否 |
| `/recommend/` | 个人推荐作品目录 | 是 |
| `/recommend/RJxxxxxxx/` | 展开推荐作品的文件树 | 是 |
| `/RJxxxxxxx/` | 直接展开指定作品 | 否 |
| `/01489611/` | 直接展开指定作品，省略 RJ 前缀 | 否 |

根目录示例：

```text
https://your-worker.example/
├── popular/
└── recommend/  # 只有非 guest Basic Auth 用户可见
```

作品目录示例：

```text
https://your-worker.example/RJ01489611/
├── 01_本編/
│   ├── TR01.wav
│   └── TR02.wav
└── 02_高画質イラスト/
    ├── ロゴ有り.jpg
    └── ロゴ無し.png
```

## 快速开始

安装依赖：

```bash
yarn install
```

本地检查：

```bash
yarn check
```

本地开发：

```bash
yarn dev
```

部署：

```bash
yarn deploy
```

部署后可以直接访问：

```text
https://your-worker.example/RJ01489611/
```

## Cloudflare 配置

`wrangler.toml` 的基本形态：

```toml
name = "kikoeru2webdav"
main = "src/index.js"
compatibility_date = "2026-06-05"

[vars]
ASMR_URL_FIELD = "mediaDownloadUrl"
ASMR_CACHE_TTL_SECONDS = "300"
DAV_TITLE = "asmr-webdav"

DAV_GUEST_USER = "guest"
DAV_GUEST_ENABLED = "true"

ASMR_POPULAR_PAGE = "1"
ASMR_POPULAR_PAGE_SIZE = "20"
ASMR_POPULAR_KEYWORD = " "

ASMR_RECOMMEND_PAGE = "1"
ASMR_RECOMMEND_PAGE_SIZE = "20"
ASMR_RECOMMEND_KEYWORD = " "

ASMR_AUTH_VALIDATE_TTL_SECONDS = "300"
```

推荐路线需要 KV 缓存 asmr.one JWT。创建 KV namespace 后绑定：

```toml
[[kv_namespaces]]
binding = "ASMR_AUTH_KV"
id = "your-kv-namespace-id"
```

生产环境不要把真实账号密码写进 `wrangler.toml`。建议使用 Wrangler secrets：

```bash
npx wrangler secret put DAV_USER
npx wrangler secret put DAV_PASS
```

如果你没有设置 `DAV_USER` / `DAV_PASS`，Worker 仍会接受客户端传来的 Basic Auth，并在访问 `/recommend/` 时把这组凭据用于 asmr.one 登录。公开部署时更建议显式设置 Basic Auth，避免任何人都能尝试登录推荐接口。

## 使用 WebDAV 客户端

### rclone

创建配置：

```bash
rclone config create kiko-webdav webdav url https://your-worker.example/ vendor other
```

列出入口目录：

```bash
rclone lsd kiko-webdav:
```

列出某个作品：

```bash
rclone ls kiko-webdav:RJ01489611
```

如果启用了 Basic Auth：

```bash
rclone config create kiko-webdav webdav \
  url https://your-worker.example/ \
  vendor other \
  user your-user \
  pass your-password
```

### Windows 资源管理器

映射网络驱动器时填写：

```text
https://your-worker.example/
```

也可以直接挂载某个作品：

```text
https://your-worker.example/RJ01489611/
```

### macOS Finder

Finder 中选择“前往” -> “连接服务器”，填写：

```text
https://your-worker.example/
```

## 热门作品

访问：

```text
https://your-worker.example/popular/
```

Worker 会请求：

```bash
curl 'https://api.asmr-200.com/api/recommender/popular' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

支持通过查询参数翻页：

```text
https://your-worker.example/popular/?page=2&pageSize=20
```

可配置默认值：

```toml
ASMR_POPULAR_PAGE = "1"
ASMR_POPULAR_PAGE_SIZE = "20"
ASMR_POPULAR_KEYWORD = " "
ASMR_POPULAR_SUBTITLE = "0"
```

`/popular/` 是公开接口，不会触发 asmr.one 登录，也不会带 Bearer token。

## 个人推荐

访问：

```text
https://your-worker.example/recommend/
```

这个接口需要非 guest 的 Basic Auth。Worker 会：

1. 读取 WebDAV Basic Auth 的用户名和密码。
2. 请求 `https://api.asmr-200.com/api/auth/me` 登录 asmr.one。
3. 从响应中保存 `token` 和 `user.recommenderUuid`。
4. 把 token 缓存在 `ASMR_AUTH_KV`。
5. 请求个人推荐接口。

推荐接口请求形态：

```bash
curl 'https://api.asmr-200.com/api/recommender/recommend-for-user' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","recommenderUuid":"<user.recommenderUuid>","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

可配置默认值：

```toml
ASMR_RECOMMEND_PAGE = "1"
ASMR_RECOMMEND_PAGE_SIZE = "20"
ASMR_RECOMMEND_KEYWORD = " "
ASMR_RECOMMEND_SUBTITLE = "0"
```

访客账号 `guest` 不能访问 `/recommend/`。根目录中也不会向 guest 显示 `recommend/`。

## 认证模式

这个项目有两层认证。

### WebDAV Basic Auth

用于保护 Worker 本身。

```bash
npx wrangler secret put DAV_USER
npx wrangler secret put DAV_PASS
```

设置后，普通用户必须提供这组用户名密码才能访问 WebDAV。

### guest 访客模式

默认启用：

```toml
DAV_GUEST_USER = "guest"
DAV_GUEST_ENABLED = "true"
```

访客可以：

- 浏览 `/`。
- 浏览 `/popular/`。
- 打开公开作品目录。

访客不可以：

- 看到根目录下的 `recommend/`。
- 访问 `/recommend/`。
- 触发 asmr.one 登录。

关闭访客模式：

```toml
DAV_GUEST_ENABLED = "false"
```

### asmr.one Token

用于推荐接口。token 来自 asmr.one 登录响应，并存进 KV。

```toml
[[kv_namespaces]]
binding = "ASMR_AUTH_KV"
id = "your-kv-namespace-id"

[vars]
ASMR_AUTH_VALIDATE_TTL_SECONDS = "300"
```

Worker 会定期用 `GET /api/auth/me` 校验缓存 token 是否仍然有效。失效后会重新登录。

## 媒体 URL 字段

作品 track API 的文件节点通常包含多个 URL 字段。默认优先使用：

```toml
ASMR_URL_FIELD = "mediaDownloadUrl"
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `mediaDownloadUrl` | 原始下载文件，最适合 WebDAV 和 rclone |
| `mediaStreamUrl` | 在线播放地址 |
| `streamLowQualityUrl` | 低码率在线播放地址 |

也可以配置多个优先级：

```toml
ASMR_URL_FIELDS = '["mediaDownloadUrl", "mediaStreamUrl", "streamLowQualityUrl"]'
```

## 手动追加远程文件

除了 asmr API 之外，也可以把任意远程 URL 混入 WebDAV：

```toml
VIRTUAL_FILES = '''
[
  {
    "path": "manual/07表白.mp3",
    "url": "https://example.com/audio/07.mp3"
  }
]
'''
```

相对路径需要配置 `REMOTE_BASE_URL`：

```toml
REMOTE_BASE_URL = "https://example.com/files/"
VIRTUAL_FILES = '["album/track01.mp3", "album/track02.mp3"]'
```

这样会生成：

```text
/album/track01.mp3
/album/track02.mp3
```

## 配置参考

### WebDAV

| 变量 | 作用 |
| --- | --- |
| `DAV_TITLE` | 根目录标题和默认认证 realm |
| `DAV_REALM` | Basic Auth realm |
| `DAV_PREFIX` | WebDAV 挂载路径前缀 |
| `MOUNT_PATH` | `DAV_PREFIX` 的兼容别名 |
| `DAV_USER` | WebDAV 用户名，建议用 secret |
| `DAV_PASS` | WebDAV 密码，建议用 secret |
| `DAV_GUEST_USER` | guest 用户名，默认 `guest` |
| `DAV_GUEST_ENABLED` | 是否启用 guest，设为 `"false"` 可关闭 |

### asmr track

| 变量 | 作用 |
| --- | --- |
| `ASMR_ID_FROM_URL` | 是否启用 `/<RJID>/` 动态路由，默认启用 |
| `ASMR_API_BASE_URL` | track API base URL |
| `ASMR_API_VERSION` | track API 版本，默认 `2` |
| `ASMR_TRACK_ID` | 固定单个作品 id |
| `ASMR_TRACK_IDS` | 固定多个作品 id |
| `ASMR_API_URL` | 直接指定 track API URL |
| `ASMR_PREFIX` | 固定作品导入时的目录前缀 |
| `ASMR_URL_FIELD` | 单个 URL 字段 |
| `ASMR_URL_FIELDS` | 多个 URL 字段优先级 |
| `ASMR_CACHE_TTL_SECONDS` | API 元数据缓存时间 |
| `ASMR_USER_AGENT` | 请求 asmr API 的 User-Agent |

### popular

| 变量 | 作用 |
| --- | --- |
| `ASMR_POPULAR_PATH` | 热门入口路径，默认 `popular` |
| `ASMR_POPULAR_API_URL` | 热门 API URL |
| `ASMR_POPULAR_PAGE` | 默认页码 |
| `ASMR_POPULAR_PAGE_SIZE` | 默认每页数量 |
| `ASMR_POPULAR_KEYWORD` | 默认关键词 |
| `ASMR_POPULAR_SUBTITLE` | 默认字幕筛选 |
| `ASMR_POPULAR_CACHE_TTL_SECONDS` | 热门列表缓存时间 |

### recommend

| 变量 | 作用 |
| --- | --- |
| `ASMR_RECOMMEND_PATH` | 推荐入口路径，默认 `recommend` |
| `ASMR_RECOMMEND_API_URL` | 推荐 API URL |
| `ASMR_RECOMMEND_PAGE` | 默认页码 |
| `ASMR_RECOMMEND_PAGE_SIZE` | 默认每页数量 |
| `ASMR_RECOMMEND_KEYWORD` | 默认关键词 |
| `ASMR_RECOMMEND_SUBTITLE` | 默认字幕筛选 |
| `ASMR_RECOMMENDER_UUID` | 推荐用户 UUID，通常由登录响应自动提供 |

### auth / KV

| 变量 | 作用 |
| --- | --- |
| `ASMR_AUTH_KV` | 默认 KV binding 名 |
| `ASMR_AUTH_KV_BINDING` | 自定义 KV binding 名 |
| `ASMR_AUTH_URL` | 登录和校验 URL |
| `ASMR_AUTH_VALIDATE_TTL_SECONDS` | token 校验间隔 |
| `ASMR_AUTH_FROM_BASIC` | 设为 `"false"` 可禁用从 Basic Auth 登录 asmr.one |
| `ASMR_AUTHORIZATION` | 手动提供 Bearer 授权 |

### 手动文件

| 变量 | 作用 |
| --- | --- |
| `REMOTE_BASE_URL` | 相对文件路径的远程 base URL |
| `VIRTUAL_FILES` | 手动文件列表 |
| `FILES` | `VIRTUAL_FILES` 兼容别名 |
| `FILE_URLS` | `VIRTUAL_FILES` 兼容别名 |
| `ALLOW_REMOTE_PATH_FALLBACK` | 是否允许把未知路径 fallback 到 `REMOTE_BASE_URL` |
| `ORIGIN_AUTHORIZATION` | 转发到远程文件源时附加的 Authorization |

## 缓存策略

- track API 和 popular API 的公开响应使用 Worker isolate 内的内存缓存。
- 推荐接口是用户相关数据，不做共享内存缓存。
- 带 Bearer token 的 track 请求不会使用公开缓存。
- asmr.one JWT token 存储在 Cloudflare KV。
- KV token 会根据 JWT 过期时间和 `ASMR_AUTH_VALIDATE_TTL_SECONDS` 做复用与校验。
- Worker 内存缓存不是持久存储，新的 isolate 可能重新请求 API。

## 项目结构

```text
src/
  index.js              Worker 入口
  app/handler.js        请求分发、认证、manifest 选择
  routing/context.js    URL 到路由上下文的转换
  asmr/api.js           track / popular / recommend API 客户端
  asmr/auth.js          asmr.one 登录、token 校验、KV 缓存
  asmr/manifest.js      把 API/config 转换成 WebDAV manifest
  http/auth.js          WebDAV Basic Auth 和 guest 模式
  http/proxy.js         远程文件流式代理
  webdav/               DAV 路径、目录、XML/HTML 响应
  shared/               通用错误和字符串工具
test/run-tests.mjs      自定义测试入口
```

更详细的 agent 交接文档见 [CLAUDE.md](./CLAUDE.md)。

## 开发和测试

语法检查和测试：

```bash
yarn check
```

只跑测试：

```bash
yarn test
```

本地 Worker：

```bash
yarn dev
```

测试覆盖了：

- 路径编码和 Unicode 文件名。
- asmr track API 树展开。
- `/popular/` 作品列表和作品展开。
- `/recommend/` 登录、token 缓存和推荐请求。
- guest 访问规则。
- 根目录入口显示规则。
- Range 代理。

## 安全说明

- 不要把真实 asmr.one 密码写进源码、README 或 `wrangler.toml`。
- 不要提交 JWT token。
- 生产环境建议用 Wrangler secrets 保存 `DAV_USER` 和 `DAV_PASS`。
- `wrangler.toml` 中的 KV id 应使用你自己的 namespace id。
- Worker 是只读 WebDAV，不支持上传、删除、移动或创建目录。
- 文件内容来自远端 API 返回的 URL，Worker 只做流式代理。

## 限制

- 目录结构依赖 asmr-200 API 返回值；如果 API 没返回某个文件，WebDAV 中也不会出现。
- Cloudflare Worker 内存缓存不是持久缓存，不能替代 KV、R2 或数据库。
- 推荐接口依赖 asmr.one 登录和 `recommenderUuid`，guest 无法使用。
- 大文件代理依赖远端是否支持 Range 和稳定下载链接。
- 这是 WebDAV 映射工具，不是媒体库数据库，也不负责补全元数据。

## 设计原则

- 只读优先：避免 WebDAV 客户端误写入远端资源。
- 流式优先：媒体响应不读入内存，直接代理。
- API 与 WebDAV 解耦：所有外部数据先转成 manifest，再由 WebDAV 层渲染。
- public 与 authenticated 分离：`/popular/` 不登录，`/recommend/` 才登录。
- guest 可浏览公共内容，但不能触发用户态推荐。
