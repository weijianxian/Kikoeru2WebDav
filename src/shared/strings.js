export function parseList(value) {
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

export function configValue(searchParams, paramName, env, envName, fallback) {
  const paramValue = searchParams?.get(paramName);
  if (paramValue !== null && paramValue !== undefined) {
    return paramValue;
  }

  const envValue = env[envName];
  return envValue === undefined || envValue === null ? fallback : envValue;
}

export function numberConfigValue(searchParams, paramName, env, envName, fallback) {
  const value = Number(configValue(searchParams, paramName, env, envName, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function arrayConfigValue(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || String(value).trim() === "") {
    return [];
  }

  const text = String(value).trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to comma/newline format.
  }

  return parseList(text);
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ensureTrailingSlash(value) {
  return String(value).endsWith("/") ? String(value) : `${value}/`;
}

export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function escapeHtml(value) {
  return escapeXml(value);
}

export function escapeHeaderValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function normalizeHttpDate(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toUTCString();
}

export function guessContentType(path) {
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
