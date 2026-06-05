# Cloudflare Workers 远程只读 WebDAV

这个 Worker 可以把 asmr-200 的 track API 返回的资源树映射成只读 WebDAV。作品 id 从 URL 传入，不需要写死在 Worker 配置里。

根目录 `/` 是入口目录：未登录或 `guest` 账号只显示 `popular/`；使用非 guest 的 Basic Auth 登录后，会额外显示 `recommend/`。

访问：

```text
https://你的-worker域名/01489611/
```

Worker 会请求：

```bash
curl -X GET 'https://api.asmr-200.com/api/tracks/01489611?v=2' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0' \
  -H 'Accept: application/json, text/plain, */*'
```

然后把返回值里的 `folder.children[]` 转成 WebDAV 目录，把音频/图片等叶子节点转成文件。文件内容不会存进 Cloudflare，客户端真正读取文件时，Worker 再把请求流式代理到 `mediaDownloadUrl` / `mediaStreamUrl`。

## URL 映射

默认入口：

```text
https://你的-worker域名/
├── popular/
└── recommend/  # 仅非 guest 登录后显示
```

WebDAV URL 的第一个路径段就是作品 id：

```text
https://你的-worker域名/01489611/
https://你的-worker域名/RJ01489611/
```

因此 `/01489611/` 这个 WebDAV 根目录会类似这样：

```text
/01_本編/TR01 「102号室に住んでいる現役JKイラストレーターは、探求心旺盛でちょっぴり危うい優等生♡」.wav
/01_本編/TR02 「資料集め -男性の身体と表情の変化-」.wav
/02_高画質イラスト/ロゴ有り.jpg
/02_高画質イラスト/ロゴ無し.png
```

## 部署

```bash
npm install
npm run deploy
```

本地检查：

```bash
npm run check
```

换作品不需要改配置，直接换 URL：

```text
https://你的-worker域名/01557615/
```

## 热门作品

访问 `/popular/` 可以用 recommender 的热门接口生成作品目录：

```text
https://你的-worker域名/popular/
```

Worker 会请求：

```bash
curl 'https://api.asmr-200.com/api/recommender/popular' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

目录里的每个作品会链接到 `/popular/RJxxxxxxx/`，进入后继续按原来的 track API 展开文件树。也可以通过查询参数翻页：

```text
https://你的-worker域名/popular/?page=2&pageSize=20
```

## 推荐作品

访问 `/recommend/` 可以用 asmr.one 的个人推荐接口生成作品目录：

```text
https://你的-worker域名/recommend/
```

这个接口需要登录。Worker 会先用 WebDAV Basic Auth 的账号密码登录 `auth/me`，从响应里保存 `token` 和 `user.recommenderUuid`，再请求：

```bash
curl 'https://api.asmr-200.com/api/recommender/recommend-for-user' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  --data-raw '{"keyword":" ","recommenderUuid":"<user.recommenderUuid>","page":1,"pageSize":20,"subtitle":0,"localSubtitledWorks":[],"withPlaylistStatus":[]}'
```

目录里的每个作品会链接到 `/recommend/RJxxxxxxx/`。访客账号 `guest` 不能访问 `/recommend/`。

## 配置

选择实际代理哪个 URL 字段：

```toml
ASMR_URL_FIELD = "mediaDownloadUrl"
```

可选值通常是：

- `mediaDownloadUrl`：原始下载文件，适合 WebDAV。
- `mediaStreamUrl`：在线播放地址。
- `streamLowQualityUrl`：低码率在线播放地址。

也可以写多个优先级：

```toml
ASMR_URL_FIELDS = '["mediaDownloadUrl", "mediaStreamUrl", "streamLowQualityUrl"]'
```

热门接口默认参数可以在 `wrangler.toml` 中配置：

```toml
ASMR_POPULAR_PAGE = "1"
ASMR_POPULAR_PAGE_SIZE = "20"
ASMR_POPULAR_KEYWORD = " "
ASMR_POPULAR_SUBTITLE = "0"
```

推荐接口默认参数也可以配置：

```toml
ASMR_RECOMMEND_PAGE = "1"
ASMR_RECOMMEND_PAGE_SIZE = "20"
ASMR_RECOMMEND_KEYWORD = " "
ASMR_RECOMMEND_SUBTITLE = "0"
```

## 可选认证

建议给公开 Worker 加 Basic Auth：

```bash
npx wrangler secret put DAV_USER
npx wrangler secret put DAV_PASS
```

默认还有一个匿名访客账号：用户名 `guest`，密码随意。访客可以浏览不需要 asmr.one 登录的接口，比如 `/popular/` 和作品目录；访客不会触发 asmr token 登录。可以在 `wrangler.toml` 里调整或关闭：

```toml
DAV_GUEST_USER = "guest"
DAV_GUEST_ENABLED = "true"
```

如果后续启用需要登录的推荐接口，可以绑定一个 KV namespace 缓存 asmr.one JWT。Worker 会把 WebDAV Basic Auth 里的用户名/密码作为 asmr 登录凭据，请求 `https://api.asmr-200.com/api/auth/me`，然后把返回的 token 存进 KV。后续需要认证的推荐请求会先用 `Bearer <token>` 调同一个接口检查有效性，失效后再重新登录。

`/popular/` 和作品 track API 不需要登录，仍然匿名请求。

```toml
[[kv_namespaces]]
binding = "ASMR_AUTH_KV"
id = "你的 KV namespace id"

[vars]
ASMR_AUTH_VALIDATE_TTL_SECONDS = "300"
```

如果你没有设置 `DAV_USER` / `DAV_PASS`，Worker 仍会接受客户端传来的 Basic Auth，并在需要认证的推荐接口里把它用于 asmr 登录；公开部署时更建议把 `DAV_USER` / `DAV_PASS` 配成同一组 asmr 账号密码。

## WebDAV 客户端

rclone：

```bash
rclone config create kiko-webdav webdav url https://你的-worker域名/01489611/ vendor other
rclone ls kiko-webdav:
```

Windows 资源管理器映射网络驱动器：

```text
https://你的-worker域名/01489611/
```

macOS Finder 的“连接服务器”：

```text
https://你的-worker域名/01489611/
```

## 手动追加 URL

如果还想混入单个手动 URL，可以加 `VIRTUAL_FILES`：

```toml
VIRTUAL_FILES = '''
[
  {
    "path": "manual/07表白.mp3",
    "url": "https://raw.kiko-play-niptan.one/media/stream/daily/2026-05-30/RJ01557615/GKSD049/01%EF%BC%9A%E3%80%90mp3%E3%80%91%E6%AD%A3%E7%AF%87/07%E8%A1%A8%E7%99%BD.mp3"
  }
]
'''
```

## 重要限制

- 这是只读 WebDAV，`PUT` / `DELETE` / `MKCOL` 等写入方法会返回 403。
- 目录列表来自 API 的 JSON；如果 API 某次没有返回某个文件，WebDAV 里也不会列出它。
- 大文件通过响应体流式返回；不要改成 `arrayBuffer()` / `text()` 读取整文件。
