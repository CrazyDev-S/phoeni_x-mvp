/**
 * Preloaded into the Next server (see the "dev" and "start" scripts) to undo a
 * proxy quirk.
 *
 * Some HTTP proxies forward the full URL as the request target
 * ("GET http://host:3000/ HTTP/1.1") instead of just the path ("GET /").
 * Next treats the "//" in "http://" as a repeated slash and answers with a 308
 * to the same URL, so the browser loops until ERR_TOO_MANY_REDIRECTS. HTTP
 * servers must accept that form, so reduce it to the path before Next sees it.
 */
const http = require("node:http");

const ABSOLUTE_FORM = /^[a-z][a-z\d+.-]*:\/\//i;
const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, req, ...rest) {
  if ((event === "request" || event === "upgrade") && ABSOLUTE_FORM.test(req.url ?? "")) {
    const url = new URL(req.url);
    req.url = url.pathname + url.search;
  }
  return emit.call(this, event, req, ...rest);
};
