import { POPULAR_PATH, RECOMMEND_PATH } from "../asmr/constants.js";
import { isAsmrTrackIdSegment } from "../asmr/ids.js";
import { HttpError } from "../shared/errors.js";
import {
  davPathFromRequest,
  inheritedHrefQuery,
  joinDavPath,
  normalizeMountPath,
  pathSegments,
} from "../webdav/paths.js";

export function routeContextFromRequest(request, env) {
  const mountedPath = davPathFromRequest(request, env);
  const searchParams = new URL(request.url).searchParams;
  const hrefQuery = inheritedHrefQuery(searchParams);

  if (env.ASMR_ID_FROM_URL !== "false") {
    const segments = pathSegments(mountedPath);
    if (segments.length === 0) {
      const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");

      return {
        path: "/",
        env: {
          ...env,
          DAV_HREF_PREFIX: mount,
          DAV_HREF_QUERY: hrefQuery,
          DAV_TITLE: env.DAV_TITLE || "asmr-webdav",
        },
        rootIndex: true,
        searchParams,
      };
    }

    const recommendContext = recommendContextFromSegments(segments, env, searchParams, hrefQuery);
    if (recommendContext) {
      return recommendContext;
    }

    const popularContext = popularContextFromSegments(segments, env, searchParams, hrefQuery);
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
          DAV_HREF_PREFIX: hrefPrefix,
          DAV_HREF_QUERY: hrefQuery,
          DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
        },
        trackId,
        searchParams,
      };
    }

    return {
      path: "/",
      env: {
        ...env,
        DAV_HREF_QUERY: hrefQuery,
      },
      needsTrackId: true,
      searchParams,
    };
  }

  return {
    path: mountedPath,
    env: {
      ...env,
      DAV_HREF_QUERY: hrefQuery,
    },
    searchParams,
  };
}

function recommendContextFromSegments(segments, env, searchParams, hrefQuery) {
  const recommendPath = RECOMMEND_PATH;
  if (!recommendPath || segments[0] !== recommendPath) {
    return undefined;
  }

  const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");

  if (segments.length === 1) {
    return {
      path: "/",
      env: {
        ...env,
        DAV_HREF_PREFIX: joinDavPath(mount, recommendPath),
        DAV_HREF_QUERY: hrefQuery,
        DAV_TITLE: "recommend",
      },
      recommendIndex: true,
      requiresAsmrAuth: true,
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
      DAV_HREF_PREFIX: joinDavPath(mount, recommendPath, trackId),
      DAV_HREF_QUERY: hrefQuery,
      DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
    },
    trackId,
    requiresAsmrAuth: true,
    searchParams,
  };
}

function popularContextFromSegments(segments, env, searchParams, hrefQuery) {
  const popularPath = POPULAR_PATH;
  if (!popularPath || segments[0] !== popularPath) {
    return undefined;
  }

  const mount = normalizeMountPath(env.DAV_PREFIX || env.MOUNT_PATH || "/");

  if (segments.length === 1) {
    return {
      path: "/",
      env: {
        ...env,
        DAV_HREF_PREFIX: joinDavPath(mount, popularPath),
        DAV_HREF_QUERY: hrefQuery,
        DAV_TITLE: "popular",
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
      DAV_HREF_PREFIX: joinDavPath(mount, popularPath, trackId),
      DAV_HREF_QUERY: hrefQuery,
      DAV_TITLE: env.DAV_TITLE || `asmr-${trackId}`,
    },
    trackId,
    searchParams,
  };
}
