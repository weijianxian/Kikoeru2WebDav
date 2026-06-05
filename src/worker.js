const DEFAULT_ASMR_API_BASE_URL = "https://api.asmr-200.com/api/tracks";
const DEFAULT_ASMR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0";
const DEFAULT_ASMR_URL_FIELDS = ["mediaDownloadUrl", "mediaStreamUrl", "streamLowQualityUrl"];

const READ_METHODS = "OPTIONS, GET, HEAD, PROPFIND";
const MUTATING_METHODS = new Set([
  "COPY",
  "DELETE",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PATCH",
  "POST",
  "PROPPATCH",
  "PUT",
  "UNLOCK",
]);

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const apiCache = new Map();

export default {
  async fetch(request, env) {
    return handleRequest(request, env ?? {});
  },
};

export async function handleRequest(request, env = {}) {
  try {
    if (!isAuthorized(request, env)) {
      return unauthorizedResponse(env);
    }

    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return optionsResponse();
    }

    if (method === "PROPFIND") {
      return await propfindResponse(request, env);
    }

    if (method === "GET" || method === "HEAD") {
      return await readResponse(request, env);
    }

    if (MUTATING_METHODS.has(method)) {
      return textResponse("This WebDAV mount is read-only.\n", 403);
    }

    return textResponse("Method not allowed.\n", 405);
  } catch (error) {
    if (error instanceof HttpError) {
      return textResponse(`${error.message}\n`, error.status);
    }

    console.error(error);
    return textResponse("Internal Server Error\n", 500);
  }
}

function isAuthorized(request, env) {
  const expectedUser = env.DAV_USER ?? "";
  const expectedPass = env.DAV_PASS ?? "";

  if (!expectedUser && !expectedPass) {
    return true;
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return false;
  }

  let decoded = "";
  try {
    decoded = atob(match[1]);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return constantTimeEqual(user, expectedUser) && constantTimeEqual(pass, expectedPass);
}

function constantTimeEqual(actual, expected) {
  const maxLength = Math.max(actual.length, expected.length);
  let diff = actual.length ^ expected.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function unauthorizedResponse(env) {
  const realm = env.DAV_REALM || env.DAV_TITLE || "remote-webdav";
  return new Response("Authentication required.\n", {
    status: 401,
    headers: davHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": `Basic realm="${escapeHeaderValue(realm)}", charset="UTF-8"`,
    }),
  });
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: davHeaders({
      Allow: READ_METHODS,
      Public: READ_METHODS,
      "Accept-Ranges": "bytes",
    }),
  });
}

async function propfindResponse(request, env) {
  const context = routeContextFromRequest(request, env);
  if (context.needsTrackId) {
    return missingTrackIdResponse(request, env);
  }

  const manifest = await buildManifest(context.env);
  const path = context.path;
  const depth = parseDepth(request.headers.get("depth"));

  const file = manifest.files.get(path);
  if (file) {
    return multistatusResponse([file], env);
  }

  const directory = manifest.dirs.get(path);
  if (!directory) {
    return textResponse("Not found.\n", 404);
  }

  const nodes = [directory];
  if (depth !== "0") {
    nodes.push(...childrenForDirectory(path, manifest, depth));
  }

  return multistatusResponse(nodes, context.env);
}

async function readResponse(request, env) {
  const context = routeContextFromRequest(request, env);
  if (context.needsTrackId) {
    return missingTrackIdResponse(request, env);
  }

  const manifest = await buildManifest(context.env);
  const path = context.path;

  if (manifest.dirs.has(path)) {
    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: davHeaders({ "Content-Type": "text/html; charset=utf-8" }),
      });
    }

    return htmlIndexResponse(path, manifest, context.env);
  }

  let file = manifest.files.get(path);
  if (!file && context.env.REMOTE_BASE_URL && context.env.ALLOW_REMOTE_PATH_FALLBACK !== "false") {
    file = fileEntry({
      path,
      url: remoteUrlFromPath(context.env.REMOTE_BASE_URL, path),
    });
  }

  if (!file) {
    return textResponse("Not found.\n", 404);
  }

  return proxyRemoteFile(request, file, context.env);
}

function routeContextFromRequest(request, env) {
  const mountedPath = davPathFromRequest(request, env);

  if (env.ASMR_ID_FROM_URL !== "false") {
    const segments = pathSegments(mountedPath);
    const trackId = segments[0];

    if (trackId && isAsmrTrackIdSegment(trackId)) {
      const rest = segments.slice(1);
      const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");
      const hrefPrefix = joinDavPath(mount, trackId);

      return {
        path: rest.length ? `/${rest.join("/")}` : "/",
        env: {
          ...env,
          ASMR_API_URL: undefined,
          ASMR_TRACK_ID: trackId,
          ASMR_TRACK_IDS: undefined,
          ASMR_PREFIX: "",
          DAV_HREF_PREFIX: hrefPrefix,
          DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
        },
      };
    }

    if (!hasStaticSourceConfig(env)) {
      return {
        path: "/",
        env,
        needsTrackId: true,
      };
    }
  }

  return {
    path: mountedPath,
    env,
  };
}

function missingTrackIdResponse(request, env) {
  const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");
  const examplePath = hrefForPath("/", true, {
    DAV_HREF_PREFIX: joinDavPath(mount, env.ASMR_EXAMPLE_TRACK_ID || "01489611"),
  });
  const exampleUrl = new URL(examplePath, request.url).toString();

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: 400,
      headers: davHeaders({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  if (request.method.toUpperCase() === "GET") {
    const body = [
      "<!doctype html>",
      '<meta charset="utf-8">',
      "<title>Missing work id</title>",
      "<h1>Missing work id</h1>",
      "<p>Put the asmr-200 work id in the URL path.</p>",
      `<p>Example: <a href="${escapeHtml(examplePath)}">${escapeHtml(exampleUrl)}</a></p>`,
    ].join("");

    return new Response(body, {
      status: 400,
      headers: davHeaders({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  return textResponse(`Put the asmr-200 work id in the URL path, for example: ${examplePath}\n`, 400);
}

async function proxyRemoteFile(request, file, env) {
  const headers = new Headers();
  copyRequestHeader(request.headers, headers, "accept");
  copyRequestHeader(request.headers, headers, "if-match");
  copyRequestHeader(request.headers, headers, "if-modified-since");
  copyRequestHeader(request.headers, headers, "if-none-match");
  copyRequestHeader(request.headers, headers, "if-range");
  copyRequestHeader(request.headers, headers, "if-unmodified-since");
  copyRequestHeader(request.headers, headers, "range");

  if (env.ORIGIN_AUTHORIZATION) {
    headers.set("authorization", env.ORIGIN_AUTHORIZATION);
  }

  const upstream = await fetch(file.remoteUrl, {
    method: request.method.toUpperCase() === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow",
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(name);
  }

  responseHeaders.set("DAV", "1");
  responseHeaders.set("MS-Author-Via", "DAV");
  responseHeaders.set("Accept-Ranges", responseHeaders.get("Accept-Ranges") || "bytes");

  if (!responseHeaders.has("Content-Type") && file.contentType) {
    responseHeaders.set("Content-Type", file.contentType);
  }

  return new Response(request.method.toUpperCase() === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function multistatusResponse(nodes, env) {
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<D:multistatus xmlns:D="DAV:">',
    ...nodes.map((node) => responseXml(node, env)),
    "</D:multistatus>",
  ].join("");

  return new Response(body, {
    status: 207,
    headers: davHeaders({ "Content-Type": "application/xml; charset=utf-8" }),
  });
}

function responseXml(node, env) {
  const isDirectory = node.type === "dir";
  const properties = [
    `<D:displayname>${escapeXml(displayName(node, env))}</D:displayname>`,
    isDirectory
      ? "<D:resourcetype><D:collection/></D:resourcetype>"
      : "<D:resourcetype/>",
  ];

  if (!isDirectory) {
    if (node.contentType) {
      properties.push(`<D:getcontenttype>${escapeXml(node.contentType)}</D:getcontenttype>`);
    }

    if (node.size !== undefined) {
      properties.push(`<D:getcontentlength>${node.size}</D:getcontentlength>`);
    }

    if (node.lastModified) {
      properties.push(`<D:getlastmodified>${escapeXml(node.lastModified)}</D:getlastmodified>`);
      properties.push(`<D:creationdate>${escapeXml(new Date(node.lastModified).toISOString())}</D:creationdate>`);
    }

    if (node.etag) {
      properties.push(`<D:getetag>${escapeXml(node.etag)}</D:getetag>`);
    }
  }

  return [
    "<D:response>",
    `<D:href>${escapeXml(hrefForPath(node.path, isDirectory, env))}</D:href>`,
    "<D:propstat>",
    "<D:prop>",
    ...properties,
    "</D:prop>",
    "<D:status>HTTP/1.1 200 OK</D:status>",
    "</D:propstat>",
    "</D:response>",
  ].join("");
}

function htmlIndexResponse(path, manifest, env) {
  const title = path === "/" ? env.DAV_TITLE || "remote-webdav" : displayName({ path }, env);
  const rows = [];

  if (path !== "/") {
    rows.push(`<li><a href="${escapeHtml(hrefForPath(parentPath(path), true, env))}">../</a></li>`);
  }

  for (const child of childrenForDirectory(path, manifest, "1")) {
    const isDirectory = child.type === "dir";
    const href = hrefForPath(child.path, isDirectory, env);
    const suffix = isDirectory ? "/" : "";
    rows.push(
      `<li><a href="${escapeHtml(href)}">${escapeHtml(displayName(child, env) + suffix)}</a></li>`,
    );
  }

  const body = [
    "<!doctype html>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<h1>${escapeHtml(title)}</h1>`,
    "<p>Read-only WebDAV view of remote HTTP files.</p>",
    `<ul>${rows.join("")}</ul>`,
  ].join("");

  return new Response(body, {
    status: 200,
    headers: davHeaders({ "Content-Type": "text/html; charset=utf-8" }),
  });
}

export async function buildManifest(env = {}) {
  const files = new Map();
  const configuredFiles = [...parseVirtualFiles(env), ...(await fetchAsmrVirtualFiles(env))];

  for (const item of configuredFiles) {
    const entry = fileEntryFromConfig(item, env);
    files.set(entry.path, entry);
  }

  const dirs = new Map();
  dirs.set("/", { type: "dir", path: "/" });

  for (const file of files.values()) {
    let current = parentPath(file.path);
    const ancestors = [];

    while (current) {
      ancestors.push(current);
      if (current === "/") {
        break;
      }
      current = parentPath(current);
    }

    for (const directory of ancestors.reverse()) {
      dirs.set(directory, { type: "dir", path: directory });
    }
  }

  return { files, dirs };
}

async function fetchAsmrVirtualFiles(env) {
  const configs = asmrTrackConfigs(env);
  if (!configs.length) {
    return [];
  }

  const entries = [];

  for (const config of configs) {
    const tree = await fetchAsmrTrackTree(config.url, env);
    entries.push(...flattenAsmrNodes(tree, config.prefix, env));
  }

  return entries;
}

function asmrTrackConfigs(env) {
  if (env.ASMR_API_URL) {
    return [
      {
        url: String(env.ASMR_API_URL),
        prefix: env.ASMR_PREFIX || "",
      },
    ];
  }

  const ids = parseList(env.ASMR_TRACK_IDS);
  if (ids.length) {
    return ids.map((id) => ({
      url: asmrApiUrlForTrack(id, env),
      prefix: env.ASMR_PREFIX ? joinDavPath(env.ASMR_PREFIX, id) : `/${sanitizeDavSegment(id)}`,
    }));
  }

  if (env.ASMR_TRACK_ID) {
    return [
      {
        url: asmrApiUrlForTrack(env.ASMR_TRACK_ID, env),
        prefix: env.ASMR_PREFIX || "",
      },
    ];
  }

  return [];
}

function asmrApiUrlForTrack(trackId, env) {
  const base = ensureTrailingSlash(env.ASMR_API_BASE_URL || DEFAULT_ASMR_API_BASE_URL);
  const normalizedId = String(trackId).trim().replace(/^RJ/i, "");
  const url = new URL(encodeURIComponent(normalizedId), base);
  url.searchParams.set("v", env.ASMR_API_VERSION || "2");
  return url.toString();
}

async function fetchAsmrTrackTree(url, env) {
  const ttl = Number(env.ASMR_CACHE_TTL_SECONDS ?? 300);
  const cached = apiCache.get(url);
  const now = Date.now();

  if (ttl > 0 && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "User-Agent": env.ASMR_USER_AGENT || DEFAULT_ASMR_USER_AGENT,
  });

  if (env.ASMR_AUTHORIZATION) {
    headers.set("Authorization", env.ASMR_AUTHORIZATION);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new HttpError(502, `Track API returned HTTP ${response.status}.`);
  }

  const value = await response.json();
  if (ttl > 0) {
    apiCache.set(url, { value, expiresAt: now + ttl * 1000 });
  }

  return value;
}

function flattenAsmrNodes(value, prefix, env) {
  const roots = Array.isArray(value)
    ? value
    : value?.children || value?.tracks || value?.data || value?.files || [];
  const entries = [];

  for (const node of roots) {
    walkAsmrNode(node, [], prefix, env, entries);
  }

  return entries;
}

function walkAsmrNode(node, ancestors, prefix, env, entries) {
  if (!node || typeof node !== "object") {
    return;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  const type = String(node.type || "").toLowerCase();
  const title = sanitizeDavSegment(node.title || node.name || "");

  if (children.length || type === "folder" || type === "directory") {
    const nextAncestors = title ? [...ancestors, title] : ancestors;
    for (const child of children) {
      walkAsmrNode(child, nextAncestors, prefix, env, entries);
    }
    return;
  }

  const remoteUrl = pickAsmrUrl(node, env);
  if (!remoteUrl) {
    return;
  }

  const fileName = title || sanitizeDavSegment(new URL(remoteUrl).pathname.split("/").pop() || "file");
  entries.push({
    path: joinDavPath(prefix, ...ancestors, fileName),
    url: remoteUrl,
    contentType: node.contentType || node.mimeType || node.mime,
    size: node.size,
    lastModified: node.lastModified || node.modified || node.mtime,
    etag: node.hash ? `W/"${String(node.hash).replaceAll('"', '\\"')}"` : node.etag,
  });
}

function pickAsmrUrl(node, env) {
  const fields = parseList(env.ASMR_URL_FIELDS || env.ASMR_URL_FIELD);
  const preferredFields = fields.length ? fields : DEFAULT_ASMR_URL_FIELDS;

  for (const field of preferredFields) {
    const value = node[field];
    if (typeof value === "string" && isHttpUrl(value)) {
      return value;
    }
  }

  return undefined;
}

function parseVirtualFiles(env) {
  const raw = env.VIRTUAL_FILES ?? env.FILES ?? env.FILE_URLS;

  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === "object") {
    return raw.files ?? [];
  }

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return [];
  }

  const text = String(raw).trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.files)) {
      return parsed.files;
    }
  } catch {
    // Fall through to newline format.
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function hasAsmrConfig(env) {
  return Boolean(env.ASMR_API_URL || env.ASMR_TRACK_ID || env.ASMR_TRACK_IDS);
}

function hasStaticSourceConfig(env) {
  return hasAsmrConfig(env) || hasManualFilesConfig(env) || Boolean(env.REMOTE_BASE_URL);
}

function hasManualFilesConfig(env) {
  const raw = env.VIRTUAL_FILES ?? env.FILES ?? env.FILE_URLS;
  if (Array.isArray(raw)) {
    return raw.length > 0;
  }
  if (raw && typeof raw === "object") {
    return Array.isArray(raw.files) && raw.files.length > 0;
  }
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

function pathSegments(path) {
  return normalizeDavPath(path).split("/").filter(Boolean);
}

function isAsmrTrackIdSegment(value) {
  return /^(?:RJ)?\d{5,}$/i.test(String(value || ""));
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  const text = String(value).trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall through to comma/newline format.
  }

  return text
    .split(/[,\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileEntryFromConfig(item, env) {
  if (typeof item === "string") {
    if (isHttpUrl(item)) {
      return fileEntry({
        path: deriveDavPathFromRemoteUrl(item, env.REMOTE_BASE_URL),
        url: item,
      });
    }

    if (!env.REMOTE_BASE_URL) {
      throw new HttpError(500, "REMOTE_BASE_URL is required for relative file paths.");
    }

    return fileEntry({
      path: item,
      url: remoteUrlFromPath(env.REMOTE_BASE_URL, normalizeDavPath(item)),
    });
  }

  if (!item || typeof item !== "object") {
    throw new HttpError(500, "Invalid VIRTUAL_FILES entry.");
  }

  const remoteUrl = item.url || item.href || item.remoteUrl;
  const path = item.path || item.name || (remoteUrl && deriveDavPathFromRemoteUrl(remoteUrl, env.REMOTE_BASE_URL));

  if (!path) {
    throw new HttpError(500, "Each VIRTUAL_FILES object needs a path or url.");
  }

  if (!remoteUrl && !env.REMOTE_BASE_URL) {
    throw new HttpError(500, "REMOTE_BASE_URL is required when a file object has no url.");
  }

  return fileEntry({
    path,
    url: remoteUrl || remoteUrlFromPath(env.REMOTE_BASE_URL, normalizeDavPath(path)),
    contentType: item.contentType || item.mimeType || item.mime,
    size: item.size ?? item.contentLength,
    lastModified: item.lastModified || item.modified || item.mtime,
    etag: item.etag,
  });
}

function fileEntry({ path, url, contentType, size, lastModified, etag }) {
  const normalizedPath = normalizeDavPath(path);
  const normalizedDate = normalizeHttpDate(lastModified);
  const normalizedSize = size === undefined || size === null || size === "" ? undefined : Number(size);

  return {
    type: "file",
    path: normalizedPath,
    remoteUrl: new URL(url).toString(),
    contentType: contentType || guessContentType(normalizedPath),
    size: Number.isFinite(normalizedSize) ? normalizedSize : undefined,
    lastModified: normalizedDate,
    etag: etag ? String(etag) : undefined,
  };
}

function childrenForDirectory(path, manifest, depth) {
  const nodes = [];
  const includeDeep = depth === "infinity";

  for (const directory of manifest.dirs.values()) {
    if (directory.path === path) {
      continue;
    }
    if (isChildPath(path, directory.path) && (includeDeep || parentPath(directory.path) === path)) {
      nodes.push(directory);
    }
  }

  for (const file of manifest.files.values()) {
    if (isChildPath(path, file.path) && (includeDeep || parentPath(file.path) === path)) {
      nodes.push(file);
    }
  }

  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "dir" ? -1 : 1;
    }
    return left.path.localeCompare(right.path, "zh-Hans-CN", { numeric: true });
  });
}

function isChildPath(parent, child) {
  if (parent === "/") {
    return child !== "/" && child.startsWith("/");
  }
  return child.startsWith(`${parent}/`);
}

function joinDavPath(...parts) {
  const segments = [];

  for (const part of parts) {
    const text = String(part || "").replaceAll("\\", "/");
    for (const segment of text.split("/")) {
      if (segment) {
        segments.push(sanitizeDavSegment(safeDecodeURIComponent(segment), "item"));
      }
    }
  }

  return segments.length ? `/${segments.join("/")}` : "/";
}

function sanitizeDavSegment(value, fallback = "") {
  const segment = String(value || "")
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  if (!segment || segment === "." || segment === "..") {
    return fallback;
  }

  return segment;
}

function parseDepth(value) {
  const depth = String(value || "infinity").toLowerCase();
  if (depth === "0" || depth === "1") {
    return depth;
  }
  return "infinity";
}

export function normalizeDavPath(path) {
  const text = String(path || "/").split("?")[0].split("#")[0].replaceAll("\\", "/");
  const withSlash = text.startsWith("/") ? text : `/${text}`;
  const segments = withSlash
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const decoded = safeDecodeURIComponent(segment);
      if (decoded === "." || decoded === "..") {
        throw new HttpError(400, "Invalid path segment.");
      }
      return decoded;
    });

  return segments.length ? `/${segments.join("/")}` : "/";
}

function davPathFromRequest(request, env) {
  const requestPath = normalizeDavPath(new URL(request.url).pathname);
  const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");

  if (mount === "/") {
    return requestPath;
  }

  if (requestPath === mount) {
    return "/";
  }

  if (requestPath.startsWith(`${mount}/`)) {
    return normalizeDavPath(requestPath.slice(mount.length));
  }

  throw new HttpError(404, "Not found.");
}

function hrefForPath(path, isDirectory, env) {
  const mount = normalizeMountPath(env.DAV_HREF_PREFIX || env.DAV_PREFIX || env.MOUNT_PATH || "/");
  const encodedPath = encodeDavPath(path);
  const href = mount === "/" ? encodedPath : `${encodeDavPath(mount).replace(/\/$/, "")}${encodedPath}`;

  if (isDirectory && href !== "/" && !href.endsWith("/")) {
    return `${href}/`;
  }

  return href;
}

function encodeDavPath(path) {
  const normalized = normalizeDavPath(path);
  if (normalized === "/") {
    return "/";
  }
  return `/${normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function normalizeMountPath(path) {
  const normalized = normalizeDavPath(path);
  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

function deriveDavPathFromRemoteUrl(remoteUrl, remoteBaseUrl) {
  const url = new URL(remoteUrl);

  if (remoteBaseUrl) {
    const base = new URL(ensureTrailingSlash(remoteBaseUrl));
    if (url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
      const relative = url.pathname.slice(base.pathname.length);
      if (relative) {
        return normalizeDavPath(relative);
      }
    }
  }

  return normalizeDavPath(url.pathname.split("/").pop() || "/");
}

function remoteUrlFromPath(remoteBaseUrl, path) {
  const base = new URL(ensureTrailingSlash(remoteBaseUrl));
  const encodedPath = normalizeDavPath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedPath, base).toString();
}

function ensureTrailingSlash(value) {
  return String(value).endsWith("/") ? String(value) : `${value}/`;
}

function parentPath(path) {
  const normalized = normalizeDavPath(path);
  if (normalized === "/") {
    return "";
  }
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function displayName(node, env) {
  if (node.path === "/") {
    return env.DAV_TITLE || "remote-webdav";
  }
  return node.path.split("/").filter(Boolean).pop() || "/";
}

function copyRequestHeader(from, to, name) {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}

function davHeaders(extra = {}) {
  return new Headers({
    DAV: "1",
    Allow: READ_METHODS,
    "MS-Author-Via": "DAV",
    ...extra,
  });
}

function textResponse(body, status) {
  return new Response(body, {
    status,
    headers: davHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

function normalizeHttpDate(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toUTCString();
}

function guessContentType(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  const types = {
    aac: "audio/aac",
    flac: "audio/flac",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    json: "application/json",
    m4a: "audio/mp4",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    pdf: "application/pdf",
    png: "image/png",
    srt: "application/x-subrip",
    txt: "text/plain; charset=utf-8",
    vtt: "text/vtt",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
    zip: "application/zip",
  };

  return types[extension] || "application/octet-stream";
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

function escapeHeaderValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
