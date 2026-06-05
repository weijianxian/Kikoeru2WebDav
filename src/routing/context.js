import { hasStaticSourceConfig } from "../asmr/manifest.js";
import { DEFAULT_ASMR_POPULAR_PATH } from "../asmr/constants.js";
import { isAsmrTrackIdSegment } from "../asmr/ids.js";
import { HttpError } from "../shared/errors.js";
import {
  davPathFromRequest,
  joinDavPath,
  normalizeMountPath,
  pathSegments,
  sanitizeDavSegment,
} from "../webdav/paths.js";

export function routeContextFromRequest(request, env) {
  const mountedPath = davPathFromRequest(request, env);

  if (env.ASMR_ID_FROM_URL !== "false") {
    const segments = pathSegments(mountedPath);
    const popularContext = popularContextFromSegments(segments, request, env);
    if (popularContext) {
      return popularContext;
    }

    const trackId = segments[0];

    if (trackId && isAsmrTrackIdSegment(trackId)) {
      const rest = segments.slice(1);
      const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");
      const hrefPrefix = joinDavPath(mount, trackId);

      return {
        path: rest.length ? `/${rest.join("/")}` : "/",
        env: {
          ...env,
          ASMR_API_URL: undefined,
          ASMR_TRACK_ID: trackId,
          ASMR_TRACK_IDS: undefined,
          ASMR_PREFIX: "",
          DAV_HREF_PREFIX: hrefPrefix,
          DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
        },
      };
    }

    if (!hasStaticSourceConfig(env)) {
      return {
        path: "/",
        env,
        needsTrackId: true,
      };
    }
  }

  return {
    path: mountedPath,
    env,
  };
}

function popularContextFromSegments(segments, request, env) {
  const popularPath = sanitizeDavSegment(env.ASMR_POPULAR_PATH || DEFAULT_ASMR_POPULAR_PATH);
  if (!popularPath || segments[0] !== popularPath) {
    return undefined;
  }

  const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");
  const searchParams = new URL(request.url).searchParams;

  if (segments.length === 1) {
    return {
      path: "/",
      env: {
        ...env,
        DAV_HREF_PREFIX: joinDavPath(mount, popularPath),
        DAV_TITLE: env.ASMR_POPULAR_TITLE || "popular",
      },
      popularIndex: true,
      searchParams,
    };
  }

  const trackId = segments[1];
  if (!isAsmrTrackIdSegment(trackId)) {
    throw new HttpError(404, "Not found.");
  }

  const rest = segments.slice(2);
  return {
    path: rest.length ? `/${rest.join("/")}` : "/",
    env: {
      ...env,
      ASMR_API_URL: undefined,
      ASMR_TRACK_ID: trackId,
      ASMR_TRACK_IDS: undefined,
      ASMR_PREFIX: "",
      DAV_HREF_PREFIX: joinDavPath(mount, popularPath, trackId),
      DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
    },
  };
}
