import { davHeaders } from "../webdav/responses.js";

export function textResponse(body, status) {
  return new Response(body, {
    status,
    headers: davHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}
