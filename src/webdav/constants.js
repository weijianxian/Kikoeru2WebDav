export const READ_METHODS = "OPTIONS, GET, HEAD, PROPFIND";

export const MUTATING_METHODS = new Set([
  "COPY",
  "DELETE",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PATCH",
  "POST",
  "PROPPATCH",
  "PUT",
  "UNLOCK",
]);
