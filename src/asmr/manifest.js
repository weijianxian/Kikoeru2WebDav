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
  DEFAULT_ASMR_MEDIA_URL_FIELDS,
  DEFAULT_ASMR_SMART_EXT,
  POPULAR_PATH,
  RECOMMEND_PATH,
} from "./constants.js";

export async function buildManifest(env = {}, searchParams = new URLSearchParams(), buildOptions = {}) {
  const files = new Map();
  const options = {
    ...manifestOptions(env, searchParams),
    trackId: buildOptions.trackId,
  };
  const configuredFiles = await fetchAsmrVirtualFiles(env, options);

  for (const item of configuredFiles) {
    const entry = fileEntry(item);
    files.set(entry.path, entry);
  }

  const manifest = manifestFromFiles(files);
  return options.smart ? smartManifest(manifest, options) : manifest;
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
  const popularPath = POPULAR_PATH;
  const recommendPath = RECOMMEND_PATH;

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

async function fetchAsmrVirtualFiles(env, options) {
  const trackId = options.trackId;
  if (!trackId) {
    return [];
  }

  const tree = await fetchAsmrTrackTree(asmrApiUrlForTrack(trackId, env), env);
  return flattenAsmrNodes(tree, "", {
    prefixFileId: options.prefixFileId ? normalizedRjId(trackId) : undefined,
  });
}

function flattenAsmrNodes(value, prefix, options = {}) {
  const roots = Array.isArray(value)
    ? value
    : value?.children || value?.tracks || value?.data || value?.files || [];
  const entries = [];

  for (const node of roots) {
    walkAsmrNode(node, [], prefix, entries, options);
  }

  return entries;
}

function walkAsmrNode(node, ancestors, prefix, entries, options) {
  if (!node || typeof node !== "object") {
    return;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  const type = String(node.type || "").toLowerCase();
  const title = sanitizeDavSegment(node.title || node.name || "");

  if (children.length || type === "folder" || type === "directory") {
    const nextAncestors = title ? [...ancestors, title] : ancestors;
    for (const child of children) {
      walkAsmrNode(child, nextAncestors, prefix, entries, options);
    }
    return;
  }

  const remoteUrl = pickAsmrUrl(node);
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

function pickAsmrUrl(node) {
  for (const field of DEFAULT_ASMR_MEDIA_URL_FIELDS) {
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
    fallback: booleanOption(searchParams, ["fallback"], env, [], false),
    prefixFileId: booleanOption(
      searchParams,
      ["prefixId", "rjPrefix", "prefix"],
      env,
      ["ASMR_PREFIX_FILE_ID", "ASMR_RJ_PREFIX"],
      true,
    ),
  };
}

function smartManifest(manifest, options) {
  const targetDirectories = targetDirectoriesForExtensions(manifest.files, options.extensions);
  if (!targetDirectories.size) {
    return options.fallback ? manifest : manifestFromFiles(new Map());
  }

  const files = new Map();
  for (const file of manifest.files.values()) {
    const directory = containingDirectory(file.path, targetDirectories);
    if (directory) {
      const path = pathWithoutDirectory(file.path, directory);
      files.set(path, { ...file, path });
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

function containingDirectory(path, directories) {
  let matched;
  for (const directory of directories) {
    if (isInsideDirectory(path, directory) && (!matched || directory.length > matched.length)) {
      matched = directory;
    }
  }

  return matched;
}

function isInsideDirectory(path, directory) {
  if (directory === "/") {
    return path !== "/" && path.startsWith("/");
  }

  return path.startsWith(`${directory}/`);
}

function pathWithoutDirectory(path, directory) {
  if (directory === "/") {
    return path;
  }

  return normalizeDavPath(path.slice(directory.length) || "/");
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
