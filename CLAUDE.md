# Kikoeru2WebDav Architecture

This project is a Cloudflare Worker that exposes remote asmr-200 resources as a read-only WebDAV filesystem. It does not store media files in Cloudflare. Directory listings are generated from API responses or local config, and file reads are streamed through the Worker to the upstream media URL.

The project is intentionally split into small ES modules under `src/`. `src/index.js` is the Worker entry point configured by `wrangler.toml`, and `src/app/handler.js` is the central request coordinator.

## Runtime Shape

- Platform: Cloudflare Workers.
- Entry file: `src/index.js`.
- Main exported handler: `default.fetch(request, env)`.
- Local scripts:
  - `npm run dev`: starts `wrangler dev`.
  - `npm run deploy`: deploys through Wrangler.
  - `npm run check`: runs syntax check and the custom test runner.
- Package manager: Yarn 4, pinned in `package.json`.
- The Worker is read-only. WebDAV mutation methods such as `PUT`, `DELETE`, `MKCOL`, `MOVE`, `LOCK`, and `PROPPATCH` return `403`.

## High-Level Request Flow

1. `src/index.js` receives the Worker fetch event and calls `handleRequest(request, env)`.
2. `src/app/handler.js` authenticates the WebDAV request with `authenticateRequest`.
3. The handler dispatches by HTTP method:
   - `OPTIONS` returns DAV capability headers.
   - `PROPFIND` builds a manifest and returns WebDAV multistatus XML.
   - `GET` and `HEAD` either return an HTML directory index or proxy a remote file.
   - Mutating methods return read-only `403`.
4. `src/routing/context.js` translates the requested URL into a normalized route context.
5. `src/app/handler.js` selects the correct manifest builder:
   - root entry listing,
   - popular work listing,
   - authenticated recommendation listing,
   - direct work tree,
   - configured track ids.
6. For file reads, `src/http/proxy.js` streams the upstream response body back to the client and forwards range-related headers.

## Directory Layout

```text
src/
  index.js              Worker entry point and public test exports.
  app/
    handler.js          Main request dispatcher and route-to-manifest coordinator.
  routing/
    context.js          URL path parsing and route context construction.
  asmr/
    api.js              asmr-200 API clients for track, popular, and recommend endpoints.
    auth.js             asmr.one login, token validation, and KV token cache.
    constants.js        Default API URLs, DAV path names, and User-Agent.
    ids.js              Work id recognition.
    manifest.js         Converts config/API data into WebDAV manifest objects.
  webdav/
    constants.js        Supported read methods and denied mutation methods.
    listing.js          Directory child selection, sorting, and display names.
    paths.js            DAV path normalization, encoding, joining, and URL mapping.
    responses.js        WebDAV XML, HTML index, OPTIONS, and missing-id responses.
  http/
    auth.js             Basic Auth and guest auth for WebDAV access.
    proxy.js            Streaming proxy for remote file content.
    responses.js        Plain text response helper.
  shared/
    errors.js           `HttpError` for controlled status-code errors.
    strings.js          Parsing, escaping, date, MIME, and URL helpers.
test/
  run-tests.mjs         Custom Node test runner with mocked `fetch` and in-memory KV.
```

## Core Data Model: Manifest

The WebDAV layer is built around a manifest:

```js
{
  files: Map<string, FileEntry>,
  dirs: Map<string, DirEntry>
}
```

Directory entries look like:

```js
{
  type: "dir",
  path: "/popular",
  displayName: "popular",
  sortOrder: 0
}
```

File entries look like:

```js
{
  type: "file",
  path: "/01/TR01.wav",
  remoteUrl: "https://...",
  contentType: "audio/wav",
  size: 12345,
  lastModified: "...",
  etag: "..."
}
```

`src/webdav/responses.js` and `src/webdav/listing.js` only need this manifest shape. They do not know whether a node came from an asmr track tree, the popular recommender API, or the authenticated recommendation API. This is the main boundary that keeps WebDAV rendering separate from upstream data fetching.

## Route Model

The Worker uses URL paths as WebDAV paths. `src/routing/context.js` normalizes the request path with `davPathFromRequest`, applies the optional mount prefix (`DAV_PREFIX` or `MOUNT_PATH`), and then returns a route context.

Current top-level routes:

- `/`
  - Root entry directory when no static source config is set.
  - Always lists `/popular/`.
  - Also lists `/recommend/` when the WebDAV Basic Auth credentials are present and are not the guest user.
  - Does not call asmr APIs and does not perform asmr.one login.
- `/popular/`
  - Calls the public popular recommender endpoint and returns works as directories.
  - Does not require asmr.one login.
- `/popular/<RJID>/`
  - Opens the selected work through the normal track API and lists its files.
- `/recommend/`
  - Requires non-guest Basic Auth.
  - Uses the Basic Auth credentials to get or refresh an asmr.one token.
  - Calls the authenticated personal recommendation endpoint.
- `/recommend/<RJID>/`
  - Opens a recommended work through the track API with asmr authorization available.
- `/<RJID>/`
  - Direct dynamic work route.
  - `RJ01489611` and `01489611` style ids are accepted.
- Configured track mode
  - If `ASMR_TRACK_ID`, `ASMR_TRACK_IDS`, or `ASMR_API_URL` is configured, the normal manifest builder is used instead of the synthetic root entry listing.

## Authentication Layers

There are two separate authentication concepts.

### WebDAV Basic Auth

Implemented in `src/http/auth.js`.

- If `DAV_USER` and `DAV_PASS` are not set, requests are allowed.
- If a Basic Auth header is present, credentials are still parsed and made available to the application. This lets `/recommend/` use those credentials for asmr.one login even when the Worker itself is not locked down.
- If `DAV_USER` and `DAV_PASS` are set, the credentials must match unless the guest mode accepts them.
- Guest mode:
  - Default guest username: `guest`.
  - Any guest password is accepted.
  - Disabled with `DAV_GUEST_ENABLED = "false"`.
  - Guest can see public routes such as `/popular/`.
  - Guest cannot access `/recommend/`.

### asmr.one Token Auth

Implemented in `src/asmr/auth.js`.

- Only contexts with `requiresAsmrAuth: true` trigger asmr token handling.
- The root listing does not trigger token handling.
- `/popular/` does not trigger token handling.
- `/recommend/` requires non-guest Basic Auth credentials.
- `envWithAsmrAuthorization(env, credentials)` returns a copy of `env` containing:
  - `ASMR_AUTHORIZATION = "Bearer <token>"`,
  - `ASMR_RECOMMENDER_UUID`.
- Tokens are stored in a KV binding by default named `ASMR_AUTH_KV`.
- `ASMR_AUTH_KV_BINDING` can override the binding name.
- KV records are keyed by a SHA-256 hash of the lowercased username, not the raw username.
- Cached tokens are checked for JWT expiration.
- Valid cached tokens are revalidated with `GET /api/auth/me` after `ASMR_AUTH_VALIDATE_TTL_SECONDS`.
- Expired or invalid tokens cause a new `POST /api/auth/me` login.

## Upstream API Clients

Implemented in `src/asmr/api.js`.

### Track API

`asmrApiUrlForTrack(trackId, env)` builds:

```text
https://api.asmr-200.com/api/tracks/<id-without-RJ>?v=2
```

`fetchAsmrTrackTree(url, env)` fetches and caches public track trees in a module-level `Map` when no authorization header is present. Authorized requests bypass this cache to avoid mixing user-specific state.

### Popular API

`fetchAsmrPopularWorks(env, searchParams)` posts to:

```text
https://api.asmr-200.com/api/recommender/popular
```

Default request body:

```json
{
  "keyword": " ",
  "page": 1,
  "pageSize": 20,
  "subtitle": 0,
  "localSubtitledWorks": [],
  "withPlaylistStatus": []
}
```

Query parameters can override `keyword`, `page`, `pageSize`, and `subtitle`. Environment variables can set defaults.

### Recommend API

`fetchAsmrRecommendedWorks(env, searchParams)` posts to:

```text
https://api.asmr-200.com/api/recommender/recommend-for-user
```

It requires:

- `ASMR_AUTHORIZATION`
- `ASMR_RECOMMENDER_UUID`

The `recommenderUuid` is intentionally sourced from the authenticated asmr.one user data, not from client query parameters.

## Manifest Builders

Implemented in `src/asmr/manifest.js`.

- `buildRootManifest(env, { includeRecommend })`
  - Builds the synthetic `/` entry directory.
  - Adds `/popular`.
  - Adds `/recommend` only when the handler says the user can see recommendations.
- `buildPopularManifest(env, searchParams)`
  - Fetches popular works and converts them to one directory per work.
- `buildRecommendManifest(env, searchParams)`
  - Fetches authenticated recommendations and converts them to one directory per work.
- `buildManifest(env)`
  - Builds the normal file tree from configured asmr track APIs.
- `fileEntry(...)`
  - Normalizes a DAV file path and remote URL.
  - Guesses content type when needed.
- `hasStaticSourceConfig(env)`
  - Decides whether root `/` should be a synthetic entry page or a normal configured filesystem.

Work directory names are derived from the first RJ-like id found in common fields such as `id`, `source_id`, `work_id`, `product_id`, `rj_code`, or `source_url`. Display names include id, title, and circle/author when available.

## WebDAV Rendering

Implemented in `src/webdav/`.

- `paths.js`
  - Normalizes DAV paths.
  - Rejects `.` and `..` path segments.
  - Encodes hrefs for XML/HTML output.
  - Applies `DAV_PREFIX`, `MOUNT_PATH`, and per-context `DAV_HREF_PREFIX`.
- `listing.js`
  - Selects children for a directory.
  - Supports `Depth: 0`, `Depth: 1`, and `Depth: infinity`.
  - Sorts directories before files, with optional `sortOrder`.
- `responses.js`
  - Builds `207 Multi-Status` XML for `PROPFIND`.
  - Builds simple HTML directory indexes for browser `GET`.
  - Adds DAV headers consistently.

## File Proxying

Implemented in `src/http/proxy.js`.

The Worker proxies file content from `file.remoteUrl` with `GET` or `HEAD`. It forwards these request headers when present:

- `accept`
- `range`
- `if-match`
- `if-none-match`
- `if-range`
- `if-modified-since`
- `if-unmodified-since`

The upstream response body is streamed directly into the Worker response. Do not replace this with `arrayBuffer()`, `text()`, or other full-buffer reads for media files.

## Configuration Variables

Configured in `wrangler.toml`, Wrangler secrets, or the Worker environment.

### WebDAV

- `DAV_TITLE`: display name for root pages and auth realm fallback.
- `DAV_REALM`: explicit Basic Auth realm.
- `DAV_PREFIX` / `MOUNT_PATH`: mount the WebDAV filesystem under a path prefix.
- `DAV_USER` / `DAV_PASS`: optional Basic Auth credentials. Prefer Wrangler secrets for production.
- `DAV_GUEST_USER`: guest username, defaults to `guest`.
- `DAV_GUEST_ENABLED`: set to `"false"` to disable guest access.

### asmr Track Files

- `ASMR_ID_FROM_URL`: defaults to enabled. Set to `"false"` to disable dynamic `/<RJID>/` routing.
- `ASMR_API_BASE_URL`: override track API base.
- `ASMR_API_VERSION`: defaults to `2`.
- `ASMR_TRACK_ID`: single configured work id.
- `ASMR_TRACK_IDS`: multiple configured work ids.
- `ASMR_API_URL`: direct track API URL override.
- `ASMR_PREFIX`: prefix for configured track files inside the manifest.
- `ASMR_URL_FIELD`: preferred media URL field.
- `ASMR_URL_FIELDS`: ordered list of media URL fields.
- `ASMR_CACHE_TTL_SECONDS`: module-level public API cache TTL.
- `ASMR_USER_AGENT`: override asmr request User-Agent.

### Popular

- `ASMR_POPULAR_PATH`: path segment, defaults to `popular`.
- `ASMR_POPULAR_API_URL`: override popular endpoint.
- `ASMR_POPULAR_PAGE`
- `ASMR_POPULAR_PAGE_SIZE`
- `ASMR_POPULAR_KEYWORD`
- `ASMR_POPULAR_SUBTITLE`
- `ASMR_POPULAR_LOCAL_SUBTITLED_WORKS`
- `ASMR_POPULAR_WITH_PLAYLIST_STATUS`
- `ASMR_POPULAR_CACHE_TTL_SECONDS`

### Recommend

- `ASMR_RECOMMEND_PATH`: path segment, defaults to `recommend`.
- `ASMR_RECOMMEND_API_URL`: override recommendation endpoint.
- `ASMR_RECOMMEND_PAGE`
- `ASMR_RECOMMEND_PAGE_SIZE`
- `ASMR_RECOMMEND_KEYWORD`
- `ASMR_RECOMMEND_SUBTITLE`
- `ASMR_RECOMMEND_LOCAL_SUBTITLED_WORKS`
- `ASMR_RECOMMEND_WITH_PLAYLIST_STATUS`
- `ASMR_RECOMMENDER_UUID`: usually set from auth response, can be configured manually if needed.

### asmr Auth

- `ASMR_AUTH_KV`: default KV binding used to store token records.
- `ASMR_AUTH_KV_BINDING`: override the binding name.
- `ASMR_AUTH_URL`: override auth endpoint.
- `ASMR_AUTH_VALIDATE_TTL_SECONDS`: cached token validation interval.
- `ASMR_AUTH_FROM_BASIC`: set to `"false"` to disable asmr login from WebDAV Basic Auth.
- `ASMR_AUTHORIZATION`: preconfigured Bearer value; skips Basic Auth login flow.

## Caching Behavior

- Public track API responses and public popular listings use a module-level `Map` cache.
- Authorized track API requests do not use the public cache.
- Popular listings are cached only when no authorization header is present.
- Recommendation responses are not module-cached because they are user-specific.
- asmr JWT tokens are stored in KV, not in the module-level API cache.
- The module-level cache is per Worker isolate and should be treated as opportunistic, not durable.

## Error Handling

Use `HttpError` for controlled status-code responses. `handleRequest` catches these and returns a plain text response with DAV headers. Unknown errors are logged and return `500 Internal Server Error`.

Common controlled errors:

- `401`: missing or failed asmr auth for recommendation routes.
- `400`: invalid DAV paths or missing id in legacy dynamic mode.
- `404`: route or manifest node not found.
- `502`: upstream API returned a non-OK response.

## Tests

Tests live in `test/run-tests.mjs` and run with:

```bash
npm run check
```

The tests are plain Node assertions. They mock `globalThis.fetch` for upstream APIs and use a small `MemoryKv` class for token-cache behavior.

Important coverage areas:

- DAV path normalization and percent-encoding.
- Manifest building from asmr track API trees.
- Dynamic `/<RJID>/` routing.
- `/popular/` directory listing and work expansion.
- `/recommend/` login, token storage, and authenticated request body.
- Guest access rules.
- Root `/` listing visibility for anonymous, authenticated, and guest users.
- Range proxying for media files.

## Extension Guidelines

When adding a new top-level collection route, follow the existing pattern:

1. Add default path/API constants in `src/asmr/constants.js`.
2. Add an API client in `src/asmr/api.js`.
3. Add a manifest builder in `src/asmr/manifest.js`.
4. Add route recognition in `src/routing/context.js`.
5. Add manifest selection in `src/app/handler.js`.
6. Add tests in `test/run-tests.mjs`.
7. Update `README.md` and this file.

Keep the WebDAV layer generic. Avoid making `webdav/*` know about asmr-specific fields. Convert external data into manifest entries first.

For Workers safety:

- Keep large media responses streaming.
- Do not store request-specific state in module-level variables.
- Do not commit real account passwords, JWTs, or KV namespace ids.
- Prefer Wrangler secrets for credentials.
- Keep KV usage through bindings (`env.ASMR_AUTH_KV`) rather than Cloudflare REST calls.
- Await all async work; do not leave floating promises.

## Known Footguns

- Root `/` only becomes the synthetic entry page when no configured track source exists. If `ASMR_TRACK_ID`, `ASMR_TRACK_IDS`, or `ASMR_API_URL` is present, `/` represents that configured filesystem.
- Showing `/recommend/` in the root listing only means non-guest Basic Auth was supplied. The actual asmr.one login still happens when `/recommend/` is opened.
- Guest Basic Auth can pass WebDAV auth but must not be allowed into routes with `requiresAsmrAuth`.
- `recommenderUuid` should come from the authenticated asmr user or trusted env, not from query parameters.
- `ASMR_AUTHORIZATION` should include the full authorization value expected by fetch, usually `Bearer <token>`.
- `wrangler.toml` values are public project config. Real `DAV_USER`, `DAV_PASS`, JWTs, and production KV ids should be secrets or deployment-specific values.
