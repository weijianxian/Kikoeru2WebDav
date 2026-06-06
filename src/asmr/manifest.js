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
  DEFAULT_ASMR_SMART_EXT,
  DEFAULT_ASMR_URL_FIELDS,
} from "./constants.js";

export async function buildManifest(env = {}, searchParams = new URLSearchParams()) {
  const files = new Map();
  const options = manifestOptions(env, searchParams);
  const configuredFiles = await fetchAsmrVirtualFiles(env, options);

  for (const item of configuredFiles) {
    const entry = fileEntry(item);
    files.set(entry.path, entry);
  }

  const manifest = manifestFromFiles(files);
  return options.smart ? smartManifest(manifest, options.extensions) : manifest;
}

function manifestFromFiles(files) {
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

async function fetchAsmrVirtualFiles(env, options) {
  const configs = asmrTrackConfigs(env);
  if (!configs.length) {
    return [];
  }

  const entries = [];

  for (const config of configs) {
    const tree = await fetchAsmrTrackTree(config.url, env);
    entries.push(
      ...flattenAsmrNodes(tree, config.prefix, env, {
        prefixFileId: options.prefixFileId ? config.trackId : undefined,
      }),
    );
  }

  return entries;
}

function asmrTrackConfigs(env) {
  if (env.ASMR_API_URL) {
    return [
      {
        url: String(env.ASMR_API_URL),
        prefix: env.ASMR_PREFIX || "",
        trackId: normalizedRjId(env.ASMR_TRACK_ID) || normalizedRjId(env.ASMR_API_URL),
      },
    ];
  }

  const ids = parseList(env.ASMR_TRACK_IDS);
  if (ids.length) {
    return ids.map((id) => ({
      url: asmrApiUrlForTrack(id, env),
      prefix: env.ASMR_PREFIX ? joinDavPath(env.ASMR_PREFIX, id) : `/${sanitizeDavSegment(id)}`,
      trackId: normalizedRjId(id),
    }));
  }

  if (env.ASMR_TRACK_ID) {
    return [
      {
        url: asmrApiUrlForTrack(env.ASMR_TRACK_ID, env),
        prefix: env.ASMR_PREFIX || "",
        trackId: normalizedRjId(env.ASMR_TRACK_ID),
      },
    ];
  }

  return [];
}

function flattenAsmrNodes(value, prefix, env, options = {}) {
  const roots = Array.isArray(value)
    ? value
    : value?.children || value?.tracks || value?.data || value?.files || [];
  const entries = [];

  for (const node of roots) {
    walkAsmrNode(node, [], prefix, env, entries, options);
  }

  return entries;
}

function walkAsmrNode(node, ancestors, prefix, env, entries, options) {
  if (!node || typeof node !== "object") {
    return;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  const type = String(node.type || "").toLowerCase();
  const title = sanitizeDavSegment(node.title || node.name || "");

  if (children.length || type === "folder" || type === "directory") {
    const nextAncestors = title ? [...ancestors, title] : ancestors;
    for (const child of children) {
      walkAsmrNode(child, nextAncestors, prefix, env, entries, options);
    }
    return;
  }

  const remoteUrl = pickAsmrUrl(node, env);
  if (!remoteUrl) {
    return;
  }

  const originalFileName = title || sanitizeDavSegment(new URL(remoteUrl).pathname.split("/").pop() || "file");
  const fileName = fileNameWithTrackId(originalFileName, options.prefixFileId);
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

function manifestOptions(env, searchParams) {
  return {
    smart: booleanOption(searchParams, ["smart"], env, ["ASMR_SMART", "ASMR_SMART_PATH"], true),
    extensions: extensionOption(searchParams, env),
    prefixFileId: booleanOption(
      searchParams,
      ["prefixId", "rjPrefix", "prefix"],
      env,
      ["ASMR_PREFIX_FILE_ID", "ASMR_RJ_PREFIX"],
      true,
    ),
  };
}

function smartManifest(manifest, extensions) {
  const targetDirectories = targetDirectoriesForExtensions(manifest.files, extensions);
  if (!targetDirectories.size) {
    return manifestFromFiles(new Map());
  }

  const files = new Map();
  for (const file of manifest.files.values()) {
    if (isInsideAnyDirectory(file.path, targetDirectories)) {
      files.set(file.path, file);
    }
  }

  return manifestFromFiles(files);
}

function targetDirectoriesForExtensions(files, extensions) {
  const extensionSet = new Set(extensions);
  const dirs = new Set();

  for (const file of files.values()) {
    if (hasTargetExtension(file.path, extensionSet)) {
      dirs.add(parentPath(file.path) || "/");
    }
  }

  return dirs;
}

function hasTargetExtension(path, extensionSet) {
  const fileName = path.split("/").filter(Boolean).pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return false;
  }

  return extensionSet.has(fileName.slice(dotIndex + 1).toLowerCase());
}

function isInsideAnyDirectory(path, directories) {
  for (const directory of directories) {
    if (isInsideDirectory(path, directory)) {
      return true;
    }
  }

  return false;
}

function isInsideDirectory(path, directory) {
  if (directory === "/") {
    return path !== "/" && path.startsWith("/");
  }

  return path.startsWith(`${directory}/`);
}

function extensionOption(searchParams, env) {
  const value =
    searchParamValue(searchParams, ["ext", "format", "formats"]) ??
    envOption(env, ["ASMR_SMART_EXT", "ASMR_AUDIO_EXT", "ASMR_AUDIO_EXTS"]) ??
    DEFAULT_ASMR_SMART_EXT;
  const extensions = parseList(value)
    .map((item) => normalizeExtension(item))
    .filter(Boolean);

  return extensions.length ? extensions : [DEFAULT_ASMR_SMART_EXT];
}

function normalizeExtension(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/^\./, "");
}

function booleanOption(searchParams, paramNames, env, envNames, fallback) {
  const paramValue = searchParamValue(searchParams, paramNames);
  if (paramValue !== undefined) {
    return parseBoolean(paramValue, fallback);
  }

  return parseBoolean(envOption(env, envNames), fallback);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(text)) {
    return false;
  }

  return fallback;
}

function searchParamValue(searchParams, names) {
  for (const name of names) {
    if (searchParams?.has?.(name)) {
      return searchParams.get(name);
    }
  }

  return undefined;
}

function envOption(env, names) {
  for (const name of names) {
    if (env[name] !== undefined && env[name] !== null) {
      return env[name];
    }
  }

  return undefined;
}

function fileNameWithTrackId(fileName, trackId) {
  const normalizedId = normalizedRjId(trackId);
  if (!normalizedId) {
    return fileName;
  }

  if (fileName.toLowerCase().startsWith(normalizedId.toLowerCase())) {
    return fileName;
  }

  return sanitizeDavSegment(`${normalizedId} ${fileName}`, fileName);
}

function hasAsmrConfig(env) {
  return Boolean(env.ASMR_API_URL || env.ASMR_TRACK_ID || env.ASMR_TRACK_IDS);
}

function normalizedRjId(value) {
  const match = String(value ?? "").match(/(?:RJ)?(\d{5,})/i);
  return match ? `RJ${match[1]}` : undefined;
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
