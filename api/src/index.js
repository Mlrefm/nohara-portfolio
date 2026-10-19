const MAX_UPLOAD = 20 * 1024 * 1024;
const TOKEN_HOURS = 12;
const attempts = new Map();

const corsHeaders = (origin, env) => {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const ok = origin && allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Content-Length",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

const json = (data, status, origin, env) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin, env) },
  });

async function shaBytes(text) {
  const data = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a[i] ^ b[i];
  return out === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function signToken(env, subject) {
  const payload = btoa(JSON.stringify({ sub: subject, exp: Date.now() + TOKEN_HOURS * 3600_000 }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

async function readToken(env, header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!equalBytes(new TextEncoder().encode(sig), new TextEncoder().encode(expected))) return null;
  try {
    const padded = payload.replaceAll("-", "+").replaceAll("_", "/");
    const jsonPayload = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
    if (jsonPayload.exp < Date.now()) return null;
    return jsonPayload.sub;
  } catch {
    return null;
  }
}

function locked(ip) {
  const row = attempts.get(ip);
  if (!row) return false;
  if (row.until && row.until > Date.now()) return true;
  if (row.until && row.until <= Date.now()) attempts.delete(ip);
  return false;
}

function failLogin(ip) {
  const row = attempts.get(ip) || { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= 8) row.until = Date.now() + 15 * 60_000;
  attempts.set(ip, row);
}

function safeName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "nohara-studio",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoApi(env, filePath) {
  return "https://api.github.com/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO + "/contents/" + filePath;
}

async function githubGet(env, filePath) {
  const res = await fetch(repoApi(env, filePath) + "?ref=" + (env.GITHUB_BRANCH || "main"), {
    headers: { ...githubHeaders(env), "Cache-Control": "no-store" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json();
}

async function githubPut(env, filePath, contentBase64, message, sha) {
  let currentSha = sha;
  let lastError = "GitHub write failed";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0 || !currentSha) {
      const existing = await githubGet(env, filePath);
      currentSha = existing?.sha;
    }
    const payload = {
      message,
      content: contentBase64,
      branch: env.GITHUB_BRANCH || "main",
    };
    if (currentSha) payload.sha = currentSha;
    const res = await fetch(repoApi(env, filePath), {
      method: "PUT",
      headers: { ...githubHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    lastError = data.message || `GitHub write failed (${res.status})`;
    if (!(res.status === 409 || /does not match|sha/i.test(lastError)) || attempt === 4) break;
    currentSha = null;
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new Error(lastError);
}

function publicFileUrl(env, filePath) {
  return "https://raw.githubusercontent.com/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO + "/" + (env.GITHUB_BRANCH || "main") + "/" + filePath;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (request.method === "GET" && url.pathname === "/content") {
      const file = await githubGet(env, "public/content.json");
      if (!file?.content) return json({ error: "No content yet" }, 404, origin, env);
      const text = decodeURIComponent(escape(atob(file.content.replaceAll("\n", ""))));
      return new Response(text, {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
      });
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      if (locked(ip)) return json({ error: "Too many attempts. Try again in a few minutes." }, 429, origin, env);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid request" }, 400, origin, env);
      }
      const userOk = equalBytes(await shaBytes(String(body.username || "")), await shaBytes(env.ADMIN_USER));
      const passOk = equalBytes(await shaBytes(String(body.password || "")), await shaBytes(env.ADMIN_PASS));
      if (!userOk || !passOk) {
        failLogin(ip);
        return json({ error: "Wrong username or password" }, 401, origin, env);
      }
      attempts.delete(ip);
      const token = await signToken(env, env.ADMIN_USER);
      return json({ token, hours: TOKEN_HOURS }, 200, origin, env);
    }

    const user = await readToken(env, request.headers.get("Authorization"));
    if (!user) return json({ error: "Sign in required" }, 401, origin, env);

    if (request.method === "PUT" && url.pathname === "/content") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400, origin, env);
      }
      if (!body || typeof body !== "object" || !body.site || !Array.isArray(body.projects)) {
        return json({ error: "Content must include site and projects" }, 400, origin, env);
      }
      const existing = await githubGet(env, "public/content.json");
      await githubPut(env, "public/content.json", btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2)))), "studio: update site content", existing?.sha);
      return json({ ok: true }, 200, origin, env);
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > MAX_UPLOAD) return json({ error: "File is larger than 20 MB" }, 413, origin, env);
      const name = safeName(url.searchParams.get("name") || "upload");
      const buffer = await request.arrayBuffer();
      const filePath = `public/uploads/${crypto.randomUUID()}-${name}`;
      await githubPut(env, filePath, toBase64(buffer), "studio: upload " + name);
      return json({ url: publicFileUrl(env, filePath), path: filePath }, 200, origin, env);
    }

    return json({ error: "Not found" }, 404, origin, env);
  },
};
