import "./admin.css";

const TOKEN_KEY = "nohara-studio";
const LOCK_NAME = "studio.lock.json";
const FAIL_KEY = "nohara-studio-fails";
const state = {
  content: null,
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  api: "",
  mode: "",
  github: null,
  lock: null,
  pat: "",
  projectIndex: -1,
};

const $ = (id) => document.getElementById(id);
const splitList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const b64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

function textToB64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

async function fileToB64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapToken(password, token) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, 210_000);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  return { salt: bytesToB64(salt), iv: bytesToB64(iv), wrap: bytesToB64(sealed), iter: 210_000 };
}

async function unwrapToken(password, lock) {
  const key = await deriveKey(password, b64ToBytes(lock.salt), lock.iter || 210_000);
  const open = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(lock.iv) }, key, b64ToBytes(lock.wrap));
  return new TextDecoder().decode(open);
}

async function shaHex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadConfig() {
  const res = await fetch(`${import.meta.env.BASE_URL}admin-config.json`, { cache: "no-store" });
  return res.ok ? res.json() : {};
}

async function resolveApi(config) {
  const envApi = import.meta.env.VITE_ADMIN_API;
  if (envApi === "github") return "";
  if (envApi) return String(envApi).replace(/\/$/, "");
  if (import.meta.env.DEV) return "/__admin";
  if (config.api) return String(config.api).replace(/\/$/, "");
  return "";
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${state.pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function githubUrl(filePath) {
  const { owner, repo, branch } = state.github;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
}

function networkHint(error) {
  const message = String(error?.message || error || "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Failed to fetch: the GitHub token is probably revoked or blocked. On the sign-in screen choose Replace GitHub token, create a new fine-grained token (Contents: Read and write), and save it. Do not paste the token in chat.";
  }
  return message;
}

async function githubFetch(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new Error(networkHint(error));
  }
}

async function githubGet(filePath) {
  const res = await githubFetch(githubUrl(filePath), {
    headers: { ...githubHeaders(), "Cache-Control": "no-store" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `GitHub read failed (${res.status})`);
  return data;
}

function isShaConflict(status, message) {
  return status === 409 || /does not match|sha/i.test(String(message || ""));
}

async function githubPut(filePath, contentBase64, message) {
  let lastError = "GitHub write failed";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await githubGet(filePath);
    const body = {
      message,
      content: contentBase64,
      branch: state.github.branch || "main",
    };
    if (existing?.sha) body.sha = existing.sha;
    let res;
    try {
      res = await githubFetch(githubUrl(filePath).replace(/\?ref=.*$/, ""), {
        method: "PUT",
        headers: { ...githubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error.message;
      break;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub rejected the token. Use Replace GitHub token on the sign-in screen.");
    }
    lastError = data.message || `GitHub write failed (${res.status})`;
    if (!isShaConflict(res.status, lastError) || attempt === 4) break;
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new Error(networkHint(lastError));
}

function rawUrl(filePath) {
  const { owner, repo, branch } = state.github;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

async function api(path, options = {}) {
  if (state.mode === "github") return githubApi(path, options);
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof Blob) && !(options.body instanceof File) && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${state.api}${path}`, { ...options, headers });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "Bad response" };
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") signOut();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function githubApi(path, options = {}) {
  const method = options.method || "GET";
  if (path === "/login") {
    const fails = JSON.parse(sessionStorage.getItem(FAIL_KEY) || "[]").filter((t) => Date.now() - t < 15 * 60_000);
    if (fails.length >= 8) throw new Error("Too many attempts. Try again in a few minutes.");
    const body = options.body;
    try {
      if (body.username !== state.lock.user) throw new Error("bad");
      state.pat = await unwrapToken(body.password, state.lock);
    } catch {
      fails.push(Date.now());
      sessionStorage.setItem(FAIL_KEY, JSON.stringify(fails));
      throw new Error("Wrong username or password");
    }
    sessionStorage.removeItem(FAIL_KEY);
    let probe;
    try {
      probe = await githubFetch(githubUrl("public/content.json"), { headers: githubHeaders() });
    } catch (error) {
      throw new Error(networkHint(error));
    }
    if (probe.status === 401 || probe.status === 403) {
      throw new Error("The GitHub token inside this password can no longer write to the repo. Use Replace GitHub token.");
    }
    return { token: "github", hours: 12 };
  }
  if (path === "/content" && method === "GET") {
    const file = await githubGet("public/content.json");
    if (!file?.content) throw new Error("No content yet");
    return JSON.parse(decodeURIComponent(escape(atob(file.content.replaceAll("\n", "")))));
  }
  if (path === "/content" && method === "PUT") {
    const body = typeof options.body === "string" ? options.body : JSON.stringify(options.body, null, 2);
    await githubPut("public/content.json", textToB64(body), "studio: update site content");
    return { ok: true };
  }
  if (path.startsWith("/upload") && method === "POST") {
    const url = new URL(path, "https://studio.local");
    const name = safeName(url.searchParams.get("name") || "upload");
    const filePath = `public/uploads/${crypto.randomUUID()}-${name}`;
    await githubPut(filePath, await fileToB64(options.body), `studio: upload ${name}`);
    const fileName = filePath.split("/").pop();
    return { url: `/uploads/${fileName}`, path: filePath, raw: rawUrl(filePath) };
  }
  throw new Error("Not found");
}

function safeName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function setStatus(message) {
  $("status").textContent = message;
}

function showLogin() {
  $("desk").hidden = true;
  $("setup").hidden = true;
  $("rekey").hidden = true;
  $("login").hidden = false;
}

function signOut() {
  state.token = "";
  state.pat = "";
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin();
}

function fillProfile() {
  const site = state.content.site;
  $("site-name").value = site.name || "";
  $("site-eyebrow").value = site.eyebrow || "";
  $("site-lede").value = site.lede || "";
  $("site-roles").value = (site.roles || []).join(", ");
  $("site-email").value = site.email || "";
  $("site-phone").value = site.phone || "";
  $("site-linkedin").value = site.linkedin || "";
  $("site-instagram").value = site.instagram || "";
  $("site-location").value = site.location || "";
  $("site-worklede").value = site.workLede || "";
  $("site-caption").value = site.portraitCaption || "";
  $("portrait-preview").src = site.portrait || "";
  $("cv-name").textContent = site.cv ? site.cv.split("/").pop() : "Upload PDF";
}

function readProfile() {
  const site = state.content.site;
  site.name = $("site-name").value.trim();
  const parts = site.name.split(/\s+/);
  site.nameHtml = parts.length > 1 ? `${parts[0]}<br />${parts.slice(1).join(" ")}` : site.name;
  site.eyebrow = $("site-eyebrow").value.trim();
  site.lede = $("site-lede").value.trim();
  site.roles = splitList($("site-roles").value);
  site.email = $("site-email").value.trim();
  site.phone = $("site-phone").value.trim();
  site.phoneHref = `tel:${site.phone.replace(/[^\d+]/g, "")}`;
  site.linkedin = $("site-linkedin").value.trim();
  site.instagram = $("site-instagram").value.trim();
  site.location = $("site-location").value.trim();
  site.workLede = $("site-worklede").value.trim();
  site.portraitCaption = $("site-caption").value.trim();
}

function renderExperience() {
  $("exp-list").replaceChildren(
    ...state.content.experience.map((item, index) => {
      const article = document.createElement("article");
      article.innerHTML = `
        <label>When <input data-k="when"></label>
        <label>Title <input data-k="title"></label>
        <label>Place <input data-k="place"></label>
        <label>Text <textarea data-k="text" rows="3"></textarea></label>
        <div class="row-actions">
          <button class="text-btn" type="button" data-move="-1">Up</button>
          <button class="text-btn" type="button" data-move="1">Down</button>
          <button class="text-btn danger" type="button" data-del>Remove</button>
        </div>`;
      for (const field of article.querySelectorAll("[data-k]")) field.value = item[field.dataset.k] || "";
      article.addEventListener("input", (event) => {
        const key = event.target.dataset.k;
        if (key) item[key] = event.target.value;
      });
      article.querySelector("[data-del]").onclick = () => {
        state.content.experience.splice(index, 1);
        renderExperience();
      };
      article.querySelectorAll("[data-move]").forEach((button) => {
        button.onclick = () => moveItem(state.content.experience, index, Number(button.dataset.move), renderExperience);
      });
      return article;
    }),
  );
}

function renderGroups() {
  $("skill-groups").replaceChildren(
    ...state.content.skills.groups.map((item, index) => {
      const article = document.createElement("article");
      article.innerHTML = `
        <label>Title <input data-k="title"></label>
        <label>Text <input data-k="text"></label>
        <div class="row-actions"><button class="text-btn danger" type="button">Remove</button></div>`;
      article.querySelector('[data-k="title"]').value = item.title || "";
      article.querySelector('[data-k="text"]').value = item.text || "";
      article.addEventListener("input", (event) => {
        item[event.target.dataset.k] = event.target.value;
      });
      article.querySelector("button").onclick = () => {
        state.content.skills.groups.splice(index, 1);
        renderGroups();
      };
      return article;
    }),
  );
}

function moveItem(list, index, dir, redraw) {
  const next = index + dir;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);
  redraw();
}

function renderProjects() {
  $("project-grid").replaceChildren(
    ...state.content.projects.map((project, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `mini${project.plate || !project.cover ? " plate" : ""}`;
      button.innerHTML = `${project.cover ? `<img alt="" src="${project.cover}">` : ""}<span class="copy"><small>${project.kind || ""}</small><strong>${project.title || "Untitled"}</strong></span>`;
      button.onclick = () => openProject(index);
      return button;
    }),
  );
}

function fileButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-btn danger";
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

function renderGallery(project) {
  $("p-gallery").replaceChildren(
    ...(project.images || []).map((src, index) => {
      const figure = document.createElement("figure");
      figure.innerHTML = `<img alt="" src="${src}">`;
      figure.append(
        fileButton("Remove", () => {
          project.images.splice(index, 1);
          renderGallery(project);
        }),
      );
      return figure;
    }),
  );
}

function renderVideos(project) {
  $("p-videos").replaceChildren(
    ...(project.videos || []).map((clip, index) => {
      const article = document.createElement("article");
      const name = document.createElement("span");
      name.textContent = (clip.src || "").split("/").pop();
      const start = document.createElement("input");
      start.type = "number";
      start.min = "0";
      start.step = "1";
      start.value = clip.start || 0;
      start.title = "Start second";
      start.oninput = () => {
        clip.start = Number(start.value) || 0;
      };
      article.append(
        name,
        start,
        fileButton("Remove", () => {
          project.videos.splice(index, 1);
          renderVideos(project);
        }),
      );
      return article;
    }),
  );
}

function renderDocs(project) {
  $("p-docs").replaceChildren(
    ...(project.documents || []).map((doc, index) => {
      const article = document.createElement("article");
      article.style.gridTemplateColumns = "1fr auto";
      const name = document.createElement("span");
      name.textContent = doc.name || doc.src;
      article.append(
        name,
        fileButton("Remove", () => {
          project.documents.splice(index, 1);
          renderDocs(project);
        }),
      );
      return article;
    }),
  );
}

function renderFacts(project) {
  $("p-facts").replaceChildren(
    ...(project.facts || []).map((pair, index) => {
      const article = document.createElement("article");
      const key = document.createElement("input");
      const value = document.createElement("input");
      key.value = pair[0] || "";
      value.value = pair[1] || "";
      key.placeholder = "Label";
      value.placeholder = "Value";
      key.oninput = () => {
        pair[0] = key.value;
      };
      value.oninput = () => {
        pair[1] = value.value;
      };
      article.append(
        key,
        value,
        fileButton("Remove", () => {
          project.facts.splice(index, 1);
          renderFacts(project);
        }),
      );
      article.style.gridTemplateColumns = "1fr 1fr auto";
      return article;
    }),
  );
}

function openProject(index) {
  state.projectIndex = index;
  const project = state.content.projects[index];
  $("sheet-title").textContent = project.title || "New project";
  $("p-title").value = project.title || "";
  $("p-kind").value = project.kind || "";
  $("p-year").value = project.year || "";
  $("p-lines").value = project.lines || "";
  $("p-text").value = project.text || "";
  $("p-plate").checked = Boolean(project.plate);
  $("p-cover-preview").src = project.cover || "";
  project.images = project.images || [];
  project.videos = project.videos || [];
  project.documents = project.documents || [];
  project.facts = project.facts || [];
  renderGallery(project);
  renderVideos(project);
  renderDocs(project);
  renderFacts(project);
  $("sheet").showModal();
}

function readProjectFields() {
  const project = state.content.projects[state.projectIndex];
  if (!project) return;
  project.title = $("p-title").value.trim();
  project.kind = $("p-kind").value.trim();
  project.year = $("p-year").value.trim();
  project.lines = $("p-lines").value.trim();
  project.text = $("p-text").value.trim();
  project.plate = $("p-plate").checked;
  if (!project.id) project.id = slug(project.title);
}

function slug(value) {
  return (
    String(value || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `project-${crypto.randomUUID().slice(0, 8)}`
  );
}

async function uploadFile(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than 20 MB`);
  setStatus(`Uploading ${file.name}…`);
  document.body.classList.add("busy");
  try {
    const data = await api(`/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "application/octet-stream")}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    setStatus("Uploaded");
    return data.url;
  } finally {
    document.body.classList.remove("busy");
  }
}

async function loadDesk() {
  try {
    state.content = await api("/content");
  } catch {
    const res = await fetch(`${import.meta.env.BASE_URL}content.json`);
    state.content = await res.json();
  }
  fillProfile();
  $("skills-a").value = state.content.skills.marqueeA.join(", ");
  $("skills-b").value = state.content.skills.marqueeB.join(", ");
  renderExperience();
  renderGroups();
  renderProjects();
  $("login").hidden = true;
  $("setup").hidden = true;
  $("desk").hidden = false;
}

$("gate").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-err").hidden = true;
  try {
    const data = await api("/login", {
      method: "POST",
      body: { username: $("user").value, password: $("pass").value },
    });
    state.token = data.token;
    sessionStorage.setItem(TOKEN_KEY, data.token);
    await loadDesk();
  } catch (error) {
    $("login-err").hidden = false;
    $("login-err").textContent = error.message;
  }
});

$("logout").onclick = signOut;

document.querySelectorAll(".tabs button").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("is-on", item === button));
    document.querySelectorAll(".pane").forEach((pane) => {
      pane.hidden = pane.id !== `tab-${button.dataset.tab}`;
    });
  };
});

$("add-exp").onclick = () => {
  state.content.experience.push({ when: "", title: "", place: "", text: "" });
  renderExperience();
};

$("add-group").onclick = () => {
  state.content.skills.groups.push({ title: "", text: "" });
  renderGroups();
};

$("add-project").onclick = () => {
  state.content.projects.push({
    id: `project-${crypto.randomUUID().slice(0, 8)}`,
    title: "New project",
    kind: "",
    year: "",
    plate: true,
    lines: "",
    text: "",
    cover: "",
    images: [],
    videos: [],
    documents: [],
    facts: [],
  });
  renderProjects();
  openProject(state.content.projects.length - 1);
};

$("add-fact").onclick = () => {
  const project = state.content.projects[state.projectIndex];
  project.facts.push(["", ""]);
  renderFacts(project);
};

$("keep-project").onclick = () => {
  readProjectFields();
  renderProjects();
  $("sheet").close();
};

$("delete-project").onclick = () => {
  if (!window.confirm("Remove this project from the live site?")) return;
  state.content.projects.splice(state.projectIndex, 1);
  renderProjects();
  $("sheet").close();
};

async function onUpload(input, apply) {
  const files = [...(input.files || [])];
  try {
    await apply(files);
  } catch (error) {
    setStatus(error.message);
    window.alert(error.message);
  }
  input.value = "";
}

$("portrait-file").onchange = (event) =>
  onUpload(event.target, async ([file]) => {
    if (!file) return;
    state.content.site.portrait = await uploadFile(file);
    $("portrait-preview").src = state.content.site.portrait;
  });

$("cv-file").onchange = (event) =>
  onUpload(event.target, async ([file]) => {
    if (!file) return;
    state.content.site.cv = await uploadFile(file);
    $("cv-name").textContent = file.name;
  });

$("p-cover").onchange = (event) =>
  onUpload(event.target, async ([file]) => {
    if (!file) return;
    const project = state.content.projects[state.projectIndex];
    project.cover = await uploadFile(file);
    $("p-cover-preview").src = project.cover;
    project.plate = false;
    $("p-plate").checked = false;
  });

$("p-images").onchange = (event) =>
  onUpload(event.target, async (files) => {
    const project = state.content.projects[state.projectIndex];
    for (const file of files) project.images.push(await uploadFile(file));
    renderGallery(project);
  });

$("p-video-files").onchange = (event) =>
  onUpload(event.target, async (files) => {
    const project = state.content.projects[state.projectIndex];
    for (const file of files) {
      const src = await uploadFile(file);
      project.videos.push({ src, start: 0, poster: project.cover || "" });
    }
    renderVideos(project);
  });

$("p-doc-files").onchange = (event) =>
  onUpload(event.target, async (files) => {
    const project = state.content.projects[state.projectIndex];
    for (const file of files) {
      const src = await uploadFile(file);
      project.documents.push({ name: file.name, src });
    }
    renderDocs(project);
  });

$("publish").onclick = async () => {
  readProfile();
  if (state.projectIndex >= 0 && $("sheet").open) readProjectFields();
  state.content.skills.marqueeA = splitList($("skills-a").value);
  state.content.skills.marqueeB = splitList($("skills-b").value);
  setStatus("Publishing…");
  try {
    await api("/content", { method: "PUT", body: state.content });
    setStatus(state.mode === "github" ? "Saved. The live site updates in about a minute." : "Live");
  } catch (error) {
    setStatus(error.message);
  }
};

$("open-rekey").onclick = () => {
  $("login").hidden = true;
  $("rekey").hidden = false;
  $("rekey-err").hidden = true;
  if (state.lock?.user) $("rekey-user").value = state.lock.user;
};

$("rekey-back").onclick = () => showLogin();

$("rekey-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("rekey-err").hidden = true;
  const username = $("rekey-user").value.trim();
  const password = $("rekey-pass").value;
  const token = $("rekey-token").value.trim();
  if (!state.lock) {
    $("rekey-err").hidden = false;
    $("rekey-err").textContent = "No studio lock found. Use First key setup.";
    return;
  }
  try {
    if (username !== state.lock.user) throw new Error("Wrong username or password");
    await unwrapToken(password, state.lock);
    state.pat = token;
    state.mode = "github";
    const probe = await githubFetch(githubUrl("public/content.json"), { headers: githubHeaders() });
    if (probe.status === 401 || probe.status === 403) {
      throw new Error("That GitHub token cannot access this repository. Check Contents: Read and write.");
    }
    const sealed = await wrapToken(password, token);
    const lock = {
      v: 1,
      user: username,
      userHash: await shaHex(username),
      ...sealed,
    };
    await githubPut(`public/${LOCK_NAME}`, textToB64(JSON.stringify(lock, null, 2)), "studio: replace lock token");
    state.lock = lock;
    state.token = "github";
    sessionStorage.setItem(TOKEN_KEY, "github");
    await loadDesk();
    setStatus("New GitHub token saved.");
  } catch (error) {
    $("rekey-err").hidden = false;
    $("rekey-err").textContent = networkHint(error);
  }
});

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("setup-err").hidden = true;
  const password = $("setup-pass").value;
  if (password !== $("setup-pass2").value) {
    $("setup-err").hidden = false;
    $("setup-err").textContent = "The two passwords do not match.";
    return;
  }
  state.github = {
    owner: $("setup-owner").value.trim(),
    repo: $("setup-repo").value.trim(),
    branch: "main",
  };
  state.pat = $("setup-token").value.trim();
  state.mode = "github";
  try {
    const probe = await githubFetch(githubUrl("public/content.json"), { headers: githubHeaders() });
    if (probe.status === 401 || probe.status === 403) throw new Error("That GitHub token cannot read this repository.");
    const sealed = await wrapToken(password, state.pat);
    const lock = {
      v: 1,
      user: $("setup-user").value.trim(),
      userHash: await shaHex($("setup-user").value.trim()),
      ...sealed,
    };
    await githubPut(`public/${LOCK_NAME}`, textToB64(JSON.stringify(lock, null, 2)), "studio: create lock");
    state.lock = lock;
    state.token = "github";
    sessionStorage.setItem(TOKEN_KEY, "github");
    await loadDesk();
    setStatus("Studio locked. Give the client only the username and password.");
  } catch (error) {
    $("setup-err").hidden = false;
    $("setup-err").textContent = networkHint(error);
  }
});

async function loadLock() {
  const urls = [`${import.meta.env.BASE_URL}${LOCK_NAME}`];
  if (state.github?.owner && state.github?.repo) urls.push(rawUrl(`public/${LOCK_NAME}`));
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch {
      /* try next */
    }
  }
  return null;
}

async function start() {
  const config = await loadConfig();
  state.github = config.github || { owner: "Mlrefm", repo: "nohara-portfolio", branch: "main" };
  $("setup-owner").value = state.github.owner || "";
  $("setup-repo").value = state.github.repo || "";
  state.api = await resolveApi(config);
  if (state.api) {
    state.mode = "worker";
    if (state.token) {
      try {
        await loadDesk();
      } catch {
        signOut();
      }
    }
    return;
  }
  state.mode = "github";
  state.lock = await loadLock();
  if (state.lock) {
    showLogin();
    if (state.token === "github") {
      state.token = "";
      sessionStorage.removeItem(TOKEN_KEY);
    }
    return;
  }
  $("login").hidden = true;
  $("rekey").hidden = true;
  $("setup").hidden = false;
}

start();
