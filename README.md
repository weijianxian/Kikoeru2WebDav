# Cloudflare Workers 远程只读 WebDAV

这个 Worker 可以把 asmr-200 的 track API 返回的资源树映射成只读 WebDAV。作品 id 从 URL 传入，不需要写死在 Worker 配置里。

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

## 可选认证

建议给公开 Worker 加 Basic Auth：

```bash
npx wrangler secret put DAV_USER
npx wrangler secret put DAV_PASS
```

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
