const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export async function proxyRemoteFile(request, file, env) {
  const headers = new Headers();
  copyRequestHeader(request.headers, headers, "accept");
  copyRequestHeader(request.headers, headers, "if-match");
  copyRequestHeader(request.headers, headers, "if-modified-since");
  copyRequestHeader(request.headers, headers, "if-none-match");
  copyRequestHeader(request.headers, headers, "if-range");
  copyRequestHeader(request.headers, headers, "if-unmodified-since");
  copyRequestHeader(request.headers, headers, "range");

  if (env.ORIGIN_AUTHORIZATION) {
    headers.set("authorization", env.ORIGIN_AUTHORIZATION);
  }

  const upstream = await fetch(file.remoteUrl, {
    method: request.method.toUpperCase() === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow",
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(name);
  }

  responseHeaders.set("DAV", "1");
  responseHeaders.set("MS-Author-Via", "DAV");
  responseHeaders.set("Accept-Ranges", responseHeaders.get("Accept-Ranges") || "bytes");

  if (!responseHeaders.has("Content-Type") && file.contentType) {
    responseHeaders.set("Content-Type", file.contentType);
  }

  return new Response(request.method.toUpperCase() === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function copyRequestHeader(from, to, name) {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}
