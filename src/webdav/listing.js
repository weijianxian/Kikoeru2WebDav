import { parentPath } from "./paths.js";

export function childrenForDirectory(path, manifest, depth) {
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
    if (Number.isFinite(left.sortOrder) && Number.isFinite(right.sortOrder) && left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    if (left.type !== right.type) {
      return left.type === "dir" ? -1 : 1;
    }
    return left.path.localeCompare(right.path, "zh-Hans-CN", { numeric: true });
  });
}

export function displayName(node, env) {
  if (node.displayName) {
    return node.displayName;
  }
  if (node.path === "/") {
    return env.DAV_TITLE || "remote-webdav";
  }
  return node.path.split("/").filter(Boolean).pop() || "/";
}

function isChildPath(parent, child) {
  if (parent === "/") {
    return child !== "/" && child.startsWith("/");
  }
  return child.startsWith(`${parent}/`);
}
