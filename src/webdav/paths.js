import { HttpError } from "../shared/errors.js";
import { safeDecodeURIComponent } from "../shared/strings.js";

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

export function davPathFromRequest(request, env) {
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

export function hrefForPath(path, isDirectory, env) {
  const mount = normalizeMountPath(env.DAV_HREF_PREFIX || env.DAV_PREFIX || env.MOUNT_PATH || "/");
  const encodedPath = encodeDavPath(path);
  let href = mount === "/" ? encodedPath : `${encodeDavPath(mount).replace(/\/$/, "")}${encodedPath}`;

  if (isDirectory && href !== "/" && !href.endsWith("/")) {
    href = `${href}/`;
  }

  const query = normalizeHrefQuery(env.DAV_HREF_QUERY);
  return query ? `${href}?${query}` : href;
}

export function inheritedHrefQuery(searchParams) {
  const inheritedNames = ["smart", "ext", "format", "formats", "prefixId", "rjPrefix", "prefix"];
  const inherited = new URLSearchParams();

  for (const name of inheritedNames) {
    for (const value of searchParams?.getAll?.(name) || []) {
      inherited.append(name, value);
    }
  }

  return inherited.toString();
}

export function encodeDavPath(path) {
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

export function normalizeMountPath(path) {
  const normalized = normalizeDavPath(path);
  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

export function joinDavPath(...parts) {
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

export function sanitizeDavSegment(value, fallback = "") {
  const segment = String(value || "")
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  if (!segment || segment === "." || segment === "..") {
    return fallback;
  }

  return segment;
}

export function parseDepth(value) {
  const depth = String(value || "infinity").toLowerCase();
  if (depth === "0" || depth === "1") {
    return depth;
  }
  return "infinity";
}

export function pathSegments(path) {
  return normalizeDavPath(path).split("/").filter(Boolean);
}

export function parentPath(path) {
  const normalized = normalizeDavPath(path);
  if (normalized === "/") {
    return "";
  }

  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function normalizeHrefQuery(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = value instanceof URLSearchParams ? value.toString() : String(value).trim();
  return text.replace(/^\?+/, "");
}
