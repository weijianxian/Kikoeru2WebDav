# Kikoeru2WebDav

Kikoeru2WebDav 是一个运行在 Cloudflare Workers 上的只读 WebDAV 网关，用来把 asmr-200 / asmr.one 的作品、热门列表和个人推荐变成可以挂载的文件系统。

它不会把音频、图片或压缩包保存到 Cloudflare。Worker 只负责生成目录、处理 WebDAV 协议、缓存必要的 API 元数据，并在客户端读取文件时把远端媒体响应流式转发回来。

## 核心能力

- 把 asmr 作品映射成 WebDAV 目录，支持 `RJ01489611` 和 `01489611` 两种写法。
- 通过 `/popular/` 浏览公开热门作品，不需要 asmr.one 登录。
- 通过 `/recommend/` 浏览个人推荐作品，需要非 guest 的 WebDAV Basic Auth。

## 快速体验

使用我已经部署好的 `https://asmr-webdav.weijx.vip/` 作为 WebDAV 服务器地址。

你可以在浏览器里访问这个地址，看看它是怎么把热门作品和推荐作品展示成目录的。也可以直接挂载这个地址，或者用 rclone 之类的工具列出目录和文件。

打开 `https://asmr-webdav.weijx.vip/popular/` 就能看到热门作品列表。点击某个作品目录就能看到它的文件树。
访问 `https://asmr-webdav.weijx.vip/recommend/` 时会触发 Basic Auth，输入你在 asmr.one 注册的用户名和密码，就能看到你的推荐作品列表。

## 自建
1. 克隆本仓库。
2. 打开 cloudlfare dashboard，创建一个新的 Worker，使用你的repository 作为 Worker 的代码来源。
3. 添加 kv 数据库绑定，绑定名称为 `ASMR_AUTH_KV`。
4. 等待部署完成

## 第三方应用
<details>
<summary>网易云音乐</summary>

在网易云音乐里，点击「我的」-「音乐应用」-「网盘」，右上角「网盘管理」添加第三方网盘，添加方式选择「WebDav」

接下来配置配置项：
- 用户名：如果你在 asmr.one 注册了账号，输入你的用户名；如果没有注册，输入 `guest`
- 密码：如果你在 asmr.one 注册了账号，输入你的密码；如果没有注册，输入任意字符串
- 服务器地址：`asmr-webdav.weijx.vip` 或者你部署的 Worker 地址，例如 `your-worker.example`
- 名称：随意输入一个名字，比如 `asmr.one`
- 协议：`https`
- 端口：`443`
- 路径：`/`

点击下方 确认添加 后，即可

！⚠ 目前暂不支持在线播放，你需要转存到网易云音乐的网盘里。操作方法是：使用右上角只能扫描功能，按提示操作

</details>

## WebDAV 目录

```text
/
├── popular/
└── recommend/          # 只有非 guest Basic Auth 用户可见

/RJ01489611/
├── 01_本編/
│   ├── TR01.wav
│   └── TR02.wav
└── 02_高画質イラスト/
    ├── ロゴ有り.jpg
    └── ロゴ無し.png
```

| 路径 | 能力 | 是否需要 asmr.one 登录 |
| --- | --- | --- |
| `/` | 入口目录。`PROPFIND /` 会触发 Basic Auth challenge。 | 否 |
| `/popular/` | 公开热门作品目录。 | 否 |
| `/popular/RJxxxxxxx/` | 展开热门作品的文件树。 | 否 |
| `/recommend/` | 个人推荐作品目录。 | 是 |
| `/recommend/RJxxxxxxx/` | 展开推荐作品的文件树。 | 是 |
| `/RJxxxxxxx/` | 直接展开指定作品。 | 否 |
| `/01489611/` | 省略 `RJ` 前缀直接展开指定作品。 | 否 |



<details>
<summary>部署与 Cloudflare 绑定</summary>

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

ASMR_AUTH_VALIDATE_TTL_SECONDS = "300"
```

项目不维护独立的 WebDAV 用户名/密码。Worker 会解析客户端传来的 Basic Auth：

- 用户名是 `guest` 时进入访客模式。
- 用户名不是 `guest` 时，这组凭据只在访问 `/recommend/` 时用于登录 asmr.one。
- `/popular/` 和直接作品路径不需要 asmr.one 登录。

KV 是可选能力，推荐给 `/recommend/` 使用。只需要在 Cloudflare 侧把 KV namespace 绑定到固定名字：

```text
ASMR_AUTH_KV
```

如果没有绑定 `ASMR_AUTH_KV`，`/recommend/` 仍然可用，但每次请求都会重新登录 asmr.one，而不是复用缓存 token。

</details>

<details>
<summary>热门与推荐接口行为</summary>

热门作品使用公开接口：

```bash
curl 'https://api.asmr-200.com/api/recommender/popular' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

推荐作品会先用 WebDAV Basic Auth 凭据登录 asmr.one，然后调用：

```bash
curl 'https://api.asmr-200.com/api/recommender/recommend-for-user' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","recommenderUuid":"<user.recommenderUuid>","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

列表接口支持用查询参数覆盖默认分页：

```text
https://your-worker.example/popular/?page=2&pageSize=20
https://your-worker.example/recommend/?page=2&pageSize=20
```

</details>

<details>
<summary>配置参考</summary>

### WebDAV

| 变量 | 作用 |
| --- | --- |
| `DAV_TITLE` | 根目录标题和默认认证 realm。 |
| `DAV_REALM` | 显式 Basic Auth realm。 |
| `DAV_PREFIX` | WebDAV 挂载路径前缀。 |
| `MOUNT_PATH` | `DAV_PREFIX` 的兼容别名。 |
| `DAV_GUEST_USER` | guest 用户名，默认 `guest`。 |
| `DAV_GUEST_ENABLED` | 设置为 `"false"` 可关闭 guest 模式。 |

### asmr track

| 变量 | 作用 |
| --- | --- |
| `ASMR_ID_FROM_URL` | 是否启用 `/<RJID>/` 动态路由，默认启用。 |
| `ASMR_API_BASE_URL` | track API base URL。 |
| `ASMR_API_VERSION` | track API 版本，默认 `2`。 |
| `ASMR_TRACK_ID` | 固定单个作品 id。 |
| `ASMR_TRACK_IDS` | 固定多个作品 id。 |
| `ASMR_API_URL` | 直接指定 track API URL。 |
| `ASMR_PREFIX` | 固定作品导入时的目录前缀。 |
| `ASMR_URL_FIELD` | 首选媒体 URL 字段。 |
| `ASMR_URL_FIELDS` | 多个媒体 URL 字段的优先级列表。 |
| `ASMR_CACHE_TTL_SECONDS` | 公开 API 元数据缓存时间。 |
| `ASMR_USER_AGENT` | 请求 asmr API 的 User-Agent。 |

### popular

| 变量 | 作用 |
| --- | --- |
| `ASMR_POPULAR_PATH` | 热门入口路径，默认 `popular`。 |
| `ASMR_POPULAR_API_URL` | 热门 API URL。 |
| `ASMR_POPULAR_PAGE` | 默认页码。 |
| `ASMR_POPULAR_PAGE_SIZE` | 默认每页数量。 |
| `ASMR_POPULAR_KEYWORD` | 默认关键词。 |
| `ASMR_POPULAR_SUBTITLE` | 默认字幕筛选。 |
| `ASMR_POPULAR_CACHE_TTL_SECONDS` | 热门列表缓存时间。 |

### recommend

| 变量 | 作用 |
| --- | --- |
| `ASMR_RECOMMEND_PATH` | 推荐入口路径，默认 `recommend`。 |
| `ASMR_RECOMMEND_API_URL` | 推荐 API URL。 |
| `ASMR_RECOMMEND_PAGE` | 默认页码。 |
| `ASMR_RECOMMEND_PAGE_SIZE` | 默认每页数量。 |
| `ASMR_RECOMMEND_KEYWORD` | 默认关键词。 |
| `ASMR_RECOMMEND_SUBTITLE` | 默认字幕筛选。 |
| `ASMR_RECOMMENDER_UUID` | 推荐用户 UUID，通常由登录响应自动提供。 |

### auth and KV

| 变量 | 作用 |
| --- | --- |
| `ASMR_AUTH_KV` | 固定 KV binding 名，用于缓存 token。 |
| `ASMR_AUTH_URL` | 登录和校验 URL。 |
| `ASMR_AUTH_VALIDATE_TTL_SECONDS` | token 校验间隔。 |
| `ASMR_AUTH_FROM_BASIC` | 设置为 `"false"` 可禁用从 Basic Auth 登录 asmr.one。 |
| `ASMR_AUTHORIZATION` | 预置 Bearer 授权值。 |

</details>

<details>
<summary>项目架构</summary>

```text
asmr track API
popular API
recommend API
        |
        v
  files / dirs manifest
        |
        v
WebDAV XML / HTML index / streamed file proxy
```

目录结构：

```text
src/
  index.js              Worker 入口
  app/handler.js        请求分发、认证、manifest 选择
  routing/context.js    URL 到路由上下文的转换
  asmr/api.js           track / popular / recommend API 客户端
  asmr/auth.js          asmr.one 登录、token 校验、KV 缓存
  asmr/manifest.js      API/config 到 WebDAV manifest 的转换
  http/auth.js          WebDAV Basic Auth 和 guest 模式
  http/proxy.js         远程文件流式代理
  webdav/               DAV 路径、目录、XML/HTML 响应
  shared/               通用错误和字符串工具
test/run-tests.mjs      自定义 Node 测试入口
```

WebDAV 层只消费统一的 manifest，不需要知道文件来自直接作品、热门列表还是推荐列表。

更详细的维护者交接文档见 [CLAUDE.md](./CLAUDE.md)。

</details>

<details>
<summary>开发、测试与安全说明</summary>

```bash
yarn check
yarn test
yarn dev
```

测试覆盖：

- DAV 路径规范化和 Unicode 文件名。
- asmr track API 文件树展开。
- `/popular/` 列表和作品展开。
- `/recommend/` 登录、token 缓存和请求体。
- 根目录 WebDAV Basic Auth challenge。
- guest 访问规则。
- Range 代理。

安全说明：

- 不要提交真实 asmr.one 密码。
- 不要提交 JWT token。
- Worker 是只读 WebDAV，会拒绝上传、删除、移动等写入行为。
- 媒体内容来自上游 URL 流式转发，不会存入 Cloudflare。
- 目录可见性依赖 API 响应；如果 API 不返回某个文件，WebDAV 也不会显示它。

</details>
