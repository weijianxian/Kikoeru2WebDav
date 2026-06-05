import { guessContentType, isHttpUrl, normalizeHttpDate, parseList } from "../shared/strings.js";
import {
  joinDavPath,
  normalizeDavPath,
  parentPath,
  sanitizeDavSegment,
} from "../webdav/paths.js";
import {
  asmrApiUrlForTrack,
  fetchAsmrPopularWorks,
  fetchAsmrRecommendedWorks,
  fetchAsmrTrackTree,
} from "./api.js";
import {
  DEFAULT_ASMR_POPULAR_PATH,
  DEFAULT_ASMR_RECOMMEND_PATH,
  DEFAULT_ASMR_URL_FIELDS,
} from "./constants.js";

export async function buildManifest(env = {}) {
  const files = new Map();
  const configuredFiles = await fetchAsmrVirtualFiles(env);

  for (const item of configuredFiles) {
    const entry = fileEntry(item);
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
  return buildWorksManifest(works);
}

export async function buildRecommendManifest(env = {}, searchParams = new URLSearchParams()) {
  const works = await fetchAsmrRecommendedWorks(env, searchParams);
  return buildWorksManifest(works);
}

export function buildRootManifest(env = {}, options = {}) {
  const dirs = new Map();
  const files = new Map();
  const popularPath = sanitizeDavSegment(env.ASMR_POPULAR_PATH || DEFAULT_ASMR_POPULAR_PATH);
  const recommendPath = sanitizeDavSegment(env.ASMR_RECOMMEND_PATH || DEFAULT_ASMR_RECOMMEND_PATH);

  dirs.set("/", { type: "dir", path: "/" });

  if (popularPath) {
    dirs.set(`/${popularPath}`, {
      type: "dir",
      path: `/${popularPath}`,
      displayName: popularPath,
      sortOrder: 0,
    });
  }

  if (options.includeRecommend && recommendPath) {
    dirs.set(`/${recommendPath}`, {
      type: "dir",
      path: `/${recommendPath}`,
      displayName: recommendPath,
      sortOrder: 1,
    });
  }

  return { files, dirs };
}

function buildWorksManifest(works) {
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
  return hasAsmrConfig(env);
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

function hasAsmrConfig(env) {
  return Boolean(env.ASMR_API_URL || env.ASMR_TRACK_ID || env.ASMR_TRACK_IDS);
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
