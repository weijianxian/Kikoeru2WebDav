import {
  buildManifest,
  buildPopularManifest,
  buildRecommendManifest,
  buildRootManifest,
} from "../asmr/manifest.js";
import { envWithAsmrAuthorization } from "../asmr/auth.js";
import { authenticateRequest, unauthorizedResponse } from "../http/auth.js";
import { proxyRemoteFile } from "../http/proxy.js";
import { textResponse } from "../http/responses.js";
import { routeContextFromRequest } from "../routing/context.js";
import { HttpError } from "../shared/errors.js";
import { MUTATING_METHODS } from "../webdav/constants.js";
import { childrenForDirectory } from "../webdav/listing.js";
import { parseDepth } from "../webdav/paths.js";
import {
  davHeaders,
  htmlIndexResponse,
  missingTrackIdResponse,
  multistatusResponse,
  optionsResponse,
} from "../webdav/responses.js";

export async function handleRequest(request, env = {}) {
  try {
    const authentication = authenticateRequest(request, env);
    if (!authentication.authorized) {
      return unauthorizedResponse(env);
    }

    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return optionsResponse();
    }

    if (method === "PROPFIND") {
      return await propfindResponse(request, env, authentication.credentials);
    }

    if (method === "GET" || method === "HEAD") {
      return await readResponse(request, env, authentication.credentials);
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

async function propfindResponse(request, env, credentials) {
  const context = routeContextFromRequest(request, env);
  if (context.needsTrackId) {
    return missingTrackIdResponse(request, env);
  }

  const contextEnv = await envForContext(context, credentials);
  const manifest = await manifestForContext(context, contextEnv, credentials);
  const path = context.path;
  const depth = parseDepth(request.headers.get("depth"));

  const file = manifest.files.get(path);
  if (file) {
    return multistatusResponse([file], contextEnv);
  }

  const directory = manifest.dirs.get(path);
  if (!directory) {
    return textResponse("Not found.\n", 404);
  }

  const nodes = [directory];
  if (depth !== "0") {
    nodes.push(...childrenForDirectory(path, manifest, depth));
  }

  return multistatusResponse(nodes, contextEnv);
}

async function readResponse(request, env, credentials) {
  const context = routeContextFromRequest(request, env);
  if (context.needsTrackId) {
    return missingTrackIdResponse(request, env);
  }

  const contextEnv = await envForContext(context, credentials);
  const manifest = await manifestForContext(context, contextEnv, credentials);
  const path = context.path;

  if (manifest.dirs.has(path)) {
    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: davHeaders({ "Content-Type": "text/html; charset=utf-8" }),
      });
    }

    return htmlIndexResponse(path, manifest, contextEnv);
  }

  const file = manifest.files.get(path);

  if (!file) {
    return textResponse("Not found.\n", 404);
  }

  return proxyRemoteFile(request, file, contextEnv);
}

async function envForContext(context, credentials) {
  if (!shouldUseAsmrAuthorization(context)) {
    return context.env;
  }

  if (!credentials || credentials.guest) {
    throw new HttpError(401, "ASMR authentication required.");
  }

  return await envWithAsmrAuthorization(context.env, credentials);
}

function shouldUseAsmrAuthorization(context) {
  return context.requiresAsmrAuth === true;
}

async function manifestForContext(context, env, credentials) {
  if (context.rootIndex) {
    return buildRootManifest(env, {
      includeRecommend: canSeeRecommend(credentials),
    });
  }

  if (context.recommendIndex) {
    return await buildRecommendManifest(env, context.searchParams);
  }

  if (context.popularIndex) {
    return await buildPopularManifest(env, context.searchParams);
  }

  return await buildManifest(env);
}

function canSeeRecommend(credentials) {
  return Boolean(credentials && !credentials.guest);
}
