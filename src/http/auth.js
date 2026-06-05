import { escapeHeaderValue } from "../shared/strings.js";
import { davHeaders } from "../webdav/responses.js";

export function isAuthorized(request, env) {
  const expectedUser = env.DAV_USER ?? "";
  const expectedPass = env.DAV_PASS ?? "";

  if (!expectedUser && !expectedPass) {
    return true;
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return false;
  }

  let decoded = "";
  try {
    decoded = atob(match[1]);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return constantTimeEqual(user, expectedUser) && constantTimeEqual(pass, expectedPass);
}

export function unauthorizedResponse(env) {
  const realm = env.DAV_REALM || env.DAV_TITLE || "remote-webdav";
  return new Response("Authentication required.\n", {
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
