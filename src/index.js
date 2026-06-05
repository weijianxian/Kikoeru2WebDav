import { handleRequest } from "./app/handler.js";

export { buildManifest } from "./asmr/manifest.js";
export { handleRequest } from "./app/handler.js";
export { normalizeDavPath } from "./webdav/paths.js";

export default {
  async fetch(request, env) {
    return handleRequest(request, env ?? {});
  },
};
