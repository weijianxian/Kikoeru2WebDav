import { escapeHeaderValue } from "../shared/strings.js";
import { davHeaders } from "../webdav/responses.js";

export function authenticateRequest(request, env) {
  const credentials = basicCredentialsFromRequest(request);
  const guestCredentials = credentials && asGuestCredentials(credentials, env);

  return {
    authorized: true,
    credentials: guestCredentials || credentials,
  };
}

export function isAuthorized(request, env) {
  return authenticateRequest(request, env).authorized;
}

export function basicCredentialsFromRequest(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return undefined;
  }

  let decoded = "";
  try {
    decoded = atob(match[1]);
  } catch {
    return undefined;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return undefined;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function unauthorizedResponse(env, body = "Authentication required.\n") {
  const realm = env.DAV_REALM || env.DAV_TITLE || "remote-webdav";
  return new Response(body, {
    status: 401,
    headers: davHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": `Basic realm="${escapeHeaderValue(realm)}", charset="UTF-8"`,
    }),
  });
}

function constantTimeEqual(actual, expected) {
  const maxLength = Math.max(actual.length, expected.length);
  let diff = actual.length ^ expected.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function asGuestCredentials(credentials, env) {
  if (env.DAV_GUEST_ENABLED === "false") {
    return undefined;
  }

  const guestUser = env.DAV_GUEST_USER || "guest";
  if (!constantTimeEqual(credentials.username, guestUser)) {
    return undefined;
  }

  return {
    ...credentials,
    guest: true,
  };
}
