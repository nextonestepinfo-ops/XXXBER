import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.PORT || 8787);
const root = process.cwd();
const store = new Map([
  ["sales-manager-entries", []],
  ["sales-manager-open-tabs", [{ id: "server-tab-a", name: "Server Tab A", staff: "test", items: [] }]],
  ["sales-manager-staff", []],
  ["sales-manager-menu", []],
  ["sales-manager-advances", []],
  ["sales-manager-cashbox", []],
  ["sales-manager-expenses", []]
]);

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { success: true });
    return;
  }

  if (url.pathname === "/api") {
    try {
      if (req.method === "GET") {
        const key = url.searchParams.get("key");
        sendJson(res, 200, {
          success: true,
          value: store.has(key) ? JSON.stringify(store.get(key)) : ""
        });
        return;
      }

      if (req.method === "POST") {
        const payload = JSON.parse(await readBody(req));
        if (payload.action === "createReceipt") {
          sendJson(res, 200, { success: true, url: "https://example.test/recovery-receipt" });
          return;
        }
        if (payload.action !== "set") throw new Error(`Unsupported action: ${payload.action}`);
        store.set(payload.key, JSON.parse(payload.value));
        sendJson(res, 200, { success: true });
        return;
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const relativePath = safePath === "/"
    ? "index.html"
    : safePath.endsWith(path.sep) || safePath.endsWith("/")
      ? path.join(safePath, "index.html")
      : safePath;
  const filePath = path.join(root, relativePath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Recovery test server: http://127.0.0.1:${port}/recovery/?recoveryApi=http://127.0.0.1:${port}/api`);
});
