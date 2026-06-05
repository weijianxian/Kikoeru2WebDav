import { escapeHtml, escapeXml } from "../shared/strings.js";
import { READ_METHODS } from "./constants.js";
import { childrenForDirectory, displayName } from "./listing.js";
import { hrefForPath, joinDavPath, parentPath } from "./paths.js";

export function davHeaders(extra = {}) {
  return new Headers({
    DAV: "1",
    Allow: READ_METHODS,
    "MS-Author-Via": "DAV",
    ...extra,
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: davHeaders({
      Allow: READ_METHODS,
      Public: READ_METHODS,
      "Accept-Ranges": "bytes",
    }),
  });
}

export function missingTrackIdResponse(request, env) {
  const mount = normalizeMountForExample(env);
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

  return new Response(`Put the asmr-200 work id in the URL path, for example: ${examplePath}\n`, {
    status: 400,
    headers: davHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

export function multistatusResponse(nodes, env) {
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

export function htmlIndexResponse(path, manifest, env) {
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

function responseXml(node, env) {
  const isDirectory = node.type === "dir";
  const properties = [
    `<D:displayname>${escapeXml(displayName(node, env))}</D:displayname>`,
    isDirectory ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>",
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

function normalizeMountForExample(env) {
  const mount = env.DAV_PREFIX || env.MOUNT_PATH || "/";
  return mount === "/" ? "/" : mount;
}
