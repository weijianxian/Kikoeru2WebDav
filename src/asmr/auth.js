import { HttpError } from "../shared/errors.js";
import { DEFAULT_ASMR_AUTH_URL, DEFAULT_ASMR_USER_AGENT } from "./constants.js";

const DEFAULT_VALIDATE_TTL_SECONDS = 300;

export async function envWithAsmrAuthorization(env, credentials) {
  if (env.ASMR_AUTHORIZATION || env.ASMR_AUTH_FROM_BASIC === "false") {
    return env;
  }

  if (credentials?.guest) {
    return env;
  }

  if (!credentials?.username || !credentials?.password) {
    return env;
  }

  const store = asmrTokenStore(env);
  if (!store) {
    throw new HttpError(500, "ASMR_AUTH_KV binding required for token authentication.");
  }

  const token = await tokenForCredentials(env, store, credentials);

  return {
    ...env,
    ASMR_AUTHORIZATION: `Bearer ${token.token}`,
    ASMR_RECOMMENDER_UUID: token.recommenderUuid || env.ASMR_RECOMMENDER_UUID,
  };
}

async function tokenForCredentials(env, store, credentials) {
  const key = await tokenKeyForUser(credentials.username);
  const cached = await readTokenRecord(store, key);
  const now = Date.now();

  if (cached?.token && !isExpired(cached.expiresAt, now)) {
    const validateTtl = Number(env.ASMR_AUTH_VALIDATE_TTL_SECONDS ?? DEFAULT_VALIDATE_TTL_SECONDS);
    if (cached.recommenderUuid && validateTtl > 0 && cached.checkedAt && now - cached.checkedAt < validateTtl * 1000) {
      return cached;
    }

    const validation = await validateAsmrToken(cached.token, env);
    if (validation) {
      const refreshed = tokenRecord(cached.token, now, validation.user);
      await putTokenRecord(store, key, refreshed);
      return refreshed;
    }
  }

  const login = await loginAsmr(credentials, env);
  const record = tokenRecord(login.token, now, login.user);
  await putTokenRecord(store, key, record);
  return record;
}

async function readTokenRecord(store, key) {
  const raw = await store.get(key);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.token) {
      return parsed;
    }
  } catch {
    // Ignore malformed cache entries.
  }

  return undefined;
}

async function putTokenRecord(store, key, record) {
  const options = {};
  if (record.expiresAt) {
    const ttl = Math.floor((record.expiresAt - Date.now()) / 1000);
    if (ttl > 60) {
      options.expirationTtl = ttl;
    }
  }

  await store.put(key, JSON.stringify(record), options);
}

async function validateAsmrToken(token, env) {
  const response = await fetch(env.ASMR_AUTH_URL || DEFAULT_ASMR_AUTH_URL, {
    method: "GET",
    headers: authHeaders({
      Authorization: `Bearer ${token}`,
    }),
  });

  if (!response.ok) {
    return false;
  }

  const body = await response.json();
  if (body?.auth === true || body?.user?.loggedIn === true) {
    return body;
  }

  return undefined;
}

async function loginAsmr(credentials, env) {
  const response = await fetch(env.ASMR_AUTH_URL || DEFAULT_ASMR_AUTH_URL, {
    method: "POST",
    headers: authHeaders({
      Authorization: "null",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      name: credentials.username,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    throw new HttpError(401, "ASMR authentication failed.");
  }

  const body = await response.json();
  if (!body?.token || body?.user?.loggedIn === false) {
    throw new HttpError(401, "ASMR authentication failed.");
  }

  return {
    token: body.token,
    user: body.user,
  };
}

function authHeaders(extra = {}) {
  return new Headers({
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "Cache-Control": "no-cache",
    Origin: "https://asmr.one",
    Pragma: "no-cache",
    Referer: "https://asmr.one/",
    "User-Agent": DEFAULT_ASMR_USER_AGENT,
    ...extra,
  });
}

function asmrTokenStore(env) {
  const store = env.ASMR_AUTH_KV;
  if (store && typeof store.get === "function" && typeof store.put === "function") {
    return store;
  }
  return undefined;
}

function tokenRecord(token, now, user = {}) {
  return {
    token,
    recommenderUuid: user.recommenderUuid,
    checkedAt: now,
    expiresAt: jwtExpiresAt(token),
  };
}

function isExpired(expiresAt, now) {
  return Number.isFinite(expiresAt) && expiresAt <= now + 60_000;
}

function jwtExpiresAt(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(atob(base64UrlToBase64(parts[1])));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function base64UrlToBase64(value) {
  const base64 = String(value).replaceAll("-", "+").replaceAll("_", "/");
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
}

async function tokenKeyForUser(username) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(username).toLowerCase()));
  return `asmr-token:${hex(digest)}`;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
