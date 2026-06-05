import { HttpError } from "../shared/errors.js";
import { guessContentType, isHttpUrl, normalizeHttpDate, parseList } from "../shared/strings.js";
import {
  deriveDavPathFromRemoteUrl,
  joinDavPath,
  normalizeDavPath,
  parentPath,
  remoteUrlFromPath,
  sanitizeDavSegment,
} from "../webdav/paths.js";
import { asmrApiUrlForTrack, fetchAsmrPopularWorks, fetchAsmrTrackTree } from "./api.js";
import { DEFAULT_ASMR_URL_FIELDS } from "./constants.js";

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

export async function buildPopularManifest(env = {}, searchParams = new URLSearchParams()) {
  const works = await fetchAsmrPopularWorks(env, searchParams);
  const dirs = new Map();
  const files = new Map();
  const seen = new Set();

  dirs.set("/", { type: "dir", path: "/" });

  for (let index = 0; index < works.length; index += 1) {
    const work = works[index];
    const trackId = trackIdFromPopularWork(work);
    if (!trackId || seen.has(trackId)) {
      continue;
    }

    seen.add(trackId);
    dirs.set(`/${trackId}`, {
      type: "dir",
      path: `/${trackId}`,
      displayName: displayNameFromPopularWork(work, trackId),
      sortOrder: index,
    });
  }

  return { files, dirs };
}

export function fileEntry({ path, url, contentType, size, lastModified, etag }) {
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

export function hasStaticSourceConfig(env) {
  return hasAsmrConfig(env) || hasManualFilesConfig(env) || Boolean(env.REMOTE_BASE_URL);
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

function hasAsmrConfig(env) {
  return Boolean(env.ASMR_API_URL || env.ASMR_TRACK_ID || env.ASMR_TRACK_IDS);
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

function trackIdFromPopularWork(work) {
  const candidates = [
    work.id,
    work.source_id,
    work.sourceId,
    work.work_id,
    work.workId,
    work.track_id,
    work.trackId,
    work.product_id,
    work.productId,
    work.rj_code,
    work.rjCode,
    work.code,
    work.source_url,
    work.sourceUrl,
  ];

  for (const candidate of candidates) {
    const match = String(candidate ?? "").match(/(?:RJ)?\d{5,}/i);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

function displayNameFromPopularWork(work, trackId) {
  const title =
    work.title || work.name || work.workTitle || work.work_title || work.displayName || work.display_name;
  const circle =
    work.circle?.name ||
    work.circleName ||
    work.circle_name ||
    work.makerName ||
    work.maker_name ||
    work.author;
  const parts = [trackId, title, circle && `(${circle})`].filter(Boolean);
  return parts.join(" ");
}
