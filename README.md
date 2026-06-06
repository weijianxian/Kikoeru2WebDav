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

！⚠ 目前暂不支持在线播放，你需要转存到网易云音乐的网盘里。操作方法是：使用右上角智能扫描功能，按提示操作

</details>

## 路径

| 路径 | 能力 | 参数 | 是否需要登录 |
| --- | --- | --- | --- |
| `/` | 入口目录 | 无 | 否 |
| `/popular/` | 特殊目录 | `?page=2&pageSize=20` | 否 |
| `/recommend/` | 特殊目录 | 无 | 是 |
| `/popular/RJxxxxxxx/` | 展开热门作品的文件树 | `?smart=1&ext=mp3&prefixId=1` | 否 |
| `/recommend/RJxxxxxxx/` | 展开推荐作品的文件树 | `?smart=1&ext=mp3&prefixId=1` | 是 |
| `/RJxxxxxxx/` | 直接作品路径 | `?smart=1&ext=mp3&prefixId=1` | 否 |
| `/01489611/` | 省略 `RJ` 前缀直接展开指定作品 | `?smart=1&ext=mp3&prefixId=1` | 否 |

作品展开路径默认启用智能目录：`smart=1`、`ext=mp3`。这包括 `/RJxxxxxxx/`、`/01489611/`、`/popular/RJxxxxxxx/` 和 `/recommend/RJxxxxxxx/`。Worker 会用 `ext` 找到包含目标后缀文件的目录，把命中的目录提升成作品根，并返回这个目录的完整内容；例如 API 原路径是 `/mp3/a.mp3` 和 `/mp3/info.txt`，WebDAV 会显示成 `/RJxxxxxxx/a.mp3` 和 `/RJxxxxxxx/info.txt`。

如果在 `/popular/` 或 `/recommend/` 列表页传入 `ext`、`smart` 或 `prefixId`，这些参数会自动带到下级作品链接里。如果没有任何文件命中 `ext`，会回退到 API 原始根目录文件树。

常用参数：

- `smart=0`：关闭智能目录，返回 API 原始文件树。
- `ext=mp3,wav`：把 `mp3` 和 `wav` 都当作目标后缀。
- `prefixId=0`：关闭文件名前的 RJ id 前缀；默认 `prefixId=1`。

## 其他说明

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

KV 是 `/recommend/` 必需能力。需要在 Cloudflare 侧把 KV namespace 绑定到固定名字：

```text
ASMR_AUTH_KV
```

如果没有绑定 `ASMR_AUTH_KV`，需要 asmr token 的路径会直接返回错误，不会尝试临时登录 asmr.one。

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
| `ASMR_SMART` | 是否默认启用智能目录，默认启用。 |
| `ASMR_SMART_EXT` | 智能目录目标后缀，默认 `mp3`。 |
| `ASMR_PREFIX_FILE_ID` | 是否默认给文件名前加 RJ id，默认启用。 |
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
| `ASMR_AUTH_KV` | 固定 KV binding 名，用于缓存 token；访问 `/recommend/` 时必需。 |
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
