import { HttpError } from "../shared/errors.js";
import {
  arrayConfigValue,
  configValue,
  ensureTrailingSlash,
  numberConfigValue,
} from "../shared/strings.js";
import {
  DEFAULT_ASMR_API_BASE_URL,
  DEFAULT_ASMR_POPULAR_API_URL,
  DEFAULT_ASMR_RECOMMEND_API_URL,
  DEFAULT_ASMR_USER_AGENT,
} from "./constants.js";

const apiCache = new Map();

export function asmrApiUrlForTrack(trackId, env) {
  const base = ensureTrailingSlash(env.ASMR_API_BASE_URL || DEFAULT_ASMR_API_BASE_URL);
  const normalizedId = String(trackId).trim().replace(/^RJ/i, "");
  const url = new URL(encodeURIComponent(normalizedId), base);
  url.searchParams.set("v", env.ASMR_API_VERSION || "2");
  return url.toString();
}

export async function fetchAsmrTrackTree(url, env) {
  const ttl = Number(env.ASMR_CACHE_TTL_SECONDS ?? 300);
  const authorization = env.ASMR_AUTHORIZATION;
  const useCache = !authorization;
  const cached = useCache ? apiCache.get(url) : undefined;
  const now = Date.now();

  if (ttl > 0 && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "User-Agent": env.ASMR_USER_AGENT || DEFAULT_ASMR_USER_AGENT,
  });

  if (authorization) {
    headers.set("Authorization", authorization);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new HttpError(502, `Track API returned HTTP ${response.status}.`);
  }

  const value = await response.json();
  if (ttl > 0 && useCache) {
    apiCache.set(url, { value, expiresAt: now + ttl * 1000 });
  }

  return value;
}

export async function fetchAsmrPopularWorks(env, searchParams) {
  const url = env.ASMR_POPULAR_API_URL || DEFAULT_ASMR_POPULAR_API_URL;
  const body = popularRequestBody(env, searchParams);
  const cacheKey = `popular:${url}:${JSON.stringify(body)}`;
  const ttl = Number(env.ASMR_POPULAR_CACHE_TTL_SECONDS ?? env.ASMR_CACHE_TTL_SECONDS ?? 300);
  const authorization = env.ASMR_AUTHORIZATION;
  const useCache = !authorization;
  const cached = useCache ? apiCache.get(cacheKey) : undefined;
  const now = Date.now();

  if (ttl > 0 && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent": env.ASMR_USER_AGENT || DEFAULT_ASMR_USER_AGENT,
  });

  if (authorization) {
    headers.set("Authorization", authorization);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HttpError(502, `Popular API returned HTTP ${response.status}.`);
  }

  const value = worksFromResponse(await response.json());
  if (ttl > 0 && useCache) {
    apiCache.set(cacheKey, { value, expiresAt: now + ttl * 1000 });
  }

  return value;
}

export async function fetchAsmrRecommendedWorks(env, searchParams) {
  const url = env.ASMR_RECOMMEND_API_URL || DEFAULT_ASMR_RECOMMEND_API_URL;
  const body = recommendRequestBody(env, searchParams);
  const authorization = env.ASMR_AUTHORIZATION;

  if (!authorization) {
    throw new HttpError(401, "ASMR authentication required.");
  }

  if (!body.recommenderUuid) {
    throw new HttpError(401, "ASMR recommender UUID unavailable.");
  }

  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent": env.ASMR_USER_AGENT || DEFAULT_ASMR_USER_AGENT,
  });
  headers.set("Authorization", authorization);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HttpError(502, `Recommend API returned HTTP ${response.status}.`);
  }

  return worksFromResponse(await response.json());
}

function popularRequestBody(env, searchParams) {
  return {
    keyword: configValue(searchParams, "keyword", env, "ASMR_POPULAR_KEYWORD", " "),
    page: numberConfigValue(searchParams, "page", env, "ASMR_POPULAR_PAGE", 1),
    pageSize: numberConfigValue(searchParams, "pageSize", env, "ASMR_POPULAR_PAGE_SIZE", 20),
    subtitle: numberConfigValue(searchParams, "subtitle", env, "ASMR_POPULAR_SUBTITLE", 0),
    localSubtitledWorks: arrayConfigValue(env.ASMR_POPULAR_LOCAL_SUBTITLED_WORKS),
    withPlaylistStatus: arrayConfigValue(env.ASMR_POPULAR_WITH_PLAYLIST_STATUS),
  };
}

function recommendRequestBody(env, searchParams) {
  return {
    keyword: configValue(searchParams, "keyword", env, "ASMR_RECOMMEND_KEYWORD", " "),
    recommenderUuid: env.ASMR_RECOMMENDER_UUID || "",
    page: numberConfigValue(searchParams, "page", env, "ASMR_RECOMMEND_PAGE", 1),
    pageSize: numberConfigValue(searchParams, "pageSize", env, "ASMR_RECOMMEND_PAGE_SIZE", 20),
    subtitle: numberConfigValue(searchParams, "subtitle", env, "ASMR_RECOMMEND_SUBTITLE", 0),
    localSubtitledWorks: arrayConfigValue(env.ASMR_RECOMMEND_LOCAL_SUBTITLED_WORKS),
    withPlaylistStatus: arrayConfigValue(env.ASMR_RECOMMEND_WITH_PLAYLIST_STATUS),
  };
}

function worksFromResponse(value) {
  const candidates = [
    value?.works,
    value?.data?.works,
    value?.data?.items,
    value?.data?.list,
    value?.data?.records,
    value?.data,
    value?.items,
    value?.results,
    value?.list,
    value?.records,
    value,
  ];
  const works = candidates.find((candidate) => Array.isArray(candidate)) || [];

  return works
    .map((item) => {
      if (item?.work && typeof item.work === "object") {
        return { ...item, ...item.work };
      }
      return item;
    })
    .filter((item) => item && typeof item === "object");
}
