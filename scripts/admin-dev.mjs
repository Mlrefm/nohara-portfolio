import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_UPLOAD = 40 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        reject(new Error("File is larger than 40 MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, data, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(data));
}

function token(secret, user) {
  const payload = Buffer.from(JSON.stringify({ sub: user, exp: Date.now() + 12 * 3600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readToken(secret, header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  const raw = header.slice(7);
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (data.exp < Date.now()) return null;
  return data.sub;
}

export default function adminDevPlugin(root) {
  const publicDir = path.join(root, "public");
  const uploads = path.join(publicDir, "uploads");
  const contentFile = path.join(publicDir, "content.json");

  return {
    name: "admin-dev",
    configureServer(server) {
      server.middlewares.use("/__admin", async (req, res, next) => {
        try {
          const url = new URL(req.url, "http://127.0.0.1");
          const user = process.env.ADMIN_USER || "nohara";
          const pass = process.env.ADMIN_PASS || "changeme";
          const secret = process.env.SESSION_SECRET || "local-dev-secret";
          const route = url.pathname.replace(/^\/__admin/, "") || "/";

          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }

          if (req.method === "GET" && route === "/content") {
            const json = fs.readFileSync(contentFile, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(json);
            return;
          }

          if (req.method === "GET" && route.startsWith("/files/")) {
            const file = path.join(uploads, path.basename(route));
            if (!fs.existsSync(file)) return send(res, 404, { error: "Missing file" });
            fs.createReadStream(file).pipe(res);
            return;
          }

          if (req.method === "POST" && route === "/login") {
            const body = JSON.parse((await readBody(req)).toString() || "{}");
            if (body.username !== user || body.password !== pass) return send(res, 401, { error: "Wrong username or password" });
            send(res, 200, { token: token(secret, user), hours: 12 });
            return;
          }

          if (!readToken(secret, req.headers.authorization)) return send(res, 401, { error: "Sign in required" });

          if (req.method === "PUT" && route === "/content") {
            const body = JSON.parse((await readBody(req)).toString());
            fs.writeFileSync(contentFile, JSON.stringify(body, null, 2));
            send(res, 200, { ok: true });
            return;
          }

          if (req.method === "POST" && route === "/upload") {
            const buf = await readBody(req);
            fs.mkdirSync(uploads, { recursive: true });
            const name = (url.searchParams.get("name") || "file").replace(/[^a-zA-Z0-9._-]+/g, "-");
            const fileName = `${crypto.randomUUID()}-${name}`;
            fs.writeFileSync(path.join(uploads, fileName), buf);
            send(res, 200, { url: `/uploads/${fileName}`, key: `files/${fileName}` });
            return;
          }

          send(res, 404, { error: "Not found" });
        } catch (error) {
          send(res, 500, { error: error.message });
          next();
        }
      });
    },
  };
}
