import { buildManifest, buildPopularManifest, fileEntry } from "../asmr/manifest.js";
import { isAuthorized, unauthorizedResponse } from "../http/auth.js";
import { proxyRemoteFile } from "../http/proxy.js";
import { textResponse } from "../http/responses.js";
import { routeContextFromRequest } from "../routing/context.js";
import { HttpError } from "../shared/errors.js";
import { MUTATING_METHODS } from "../webdav/constants.js";
import { childrenForDirectory } from "../webdav/listing.js";
import { parseDepth, remoteUrlFromPath } from "../webdav/paths.js";
import {
  davHeaders,
  htmlIndexResponse,
  missingTrackIdResponse,
  multistatusResponse,
  optionsResponse,
} from "../webdav/responses.js";

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

async function propfindResponse(request, env) {
  const context = routeContextFromRequest(request, env);
  if (context.needsTrackId) {
    return missingTrackIdResponse(request, env);
  }

  const manifest = context.popularIndex
    ? await buildPopularManifest(context.env, context.searchParams)
    : await buildManifest(context.env);
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

  const manifest = context.popularIndex
    ? await buildPopularManifest(context.env, context.searchParams)
    : await buildManifest(context.env);
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
