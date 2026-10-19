import "./admin.css";

const TOKEN_KEY = "nohara-studio";
const state = { content: null, token: sessionStorage.getItem(TOKEN_KEY) || "", api: "", projectIndex: -1 };

const $ = (id) => document.getElementById(id);
const splitList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

async function resolveApi() {
  if (import.meta.env.VITE_ADMIN_API) return import.meta.env.VITE_ADMIN_API.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/__admin";
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}admin-config.json`);
    if (res.ok) {
      const data = await res.json();
      if (data.api) return String(data.api).replace(/\/$/, "");
    }
  } catch {
    /* empty */
  }
  return "";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof Blob) && typeof options.body !== "string") {
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

function setStatus(message) {
  $("status").textContent = message;
}

function signOut() {
  state.token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  $("desk").hidden = true;
  $("login").hidden = false;
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
        <label>When <input data-k="when" value=""></label>
        <label>Title <input data-k="title" value=""></label>
        <label>Place <input data-k="place" value=""></label>
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
  button.className = "text-btn";
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

function renderGallery(project) {
  $("p-gallery").replaceChildren(
    ...(project.images || []).map((src, index) => {
      const figure = document.createElement("figure");
      figure.innerHTML = `<img alt="" src="${src}">`;
      figure.append(fileButton("ª", () => {
        project.images.splice(index, 1);
        renderGallery(project);
      }));
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
      article.append(name, start, fileButton("ª", () => {
        project.videos.splice(index, 1);
        renderVideos(project);
      }));
      return article;
    }),
  );
}

function renderDocs(project) {
  $("p-docs").replaceChildren(
    ...(project.documents || []).map((doc, index) => {
      const article = document.createElement("article");
      const name = document.createElement("span");
      name.textContent = doc.name || doc.src;
      article.append(
        name,
        fileButton("ª", () => {
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
        fileButton("ª", () => {
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

$("portrait-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.content.site.portrait = await uploadFile(file);
  $("portrait-preview").src = state.content.site.portrait;
};

$("cv-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.content.site.cv = await uploadFile(file);
  $("cv-name").textContent = file.name;
};

$("p-cover").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const project = state.content.projects[state.projectIndex];
  project.cover = await uploadFile(file);
  $("p-cover-preview").src = project.cover;
  project.plate = false;
  $("p-plate").checked = false;
};

$("p-images").onchange = async (event) => {
  const files = [...(event.target.files || [])];
  const project = state.content.projects[state.projectIndex];
  for (const file of files) project.images.push(await uploadFile(file));
  renderGallery(project);
  event.target.value = "";
};

$("p-video-files").onchange = async (event) => {
  const files = [...(event.target.files || [])];
  const project = state.content.projects[state.projectIndex];
  for (const file of files) {
    const src = await uploadFile(file);
    project.videos.push({ src, start: 0, poster: project.cover || "" });
  }
  renderVideos(project);
  event.target.value = "";
};

$("p-doc-files").onchange = async (event) => {
  const files = [...(event.target.files || [])];
  const project = state.content.projects[state.projectIndex];
  for (const file of files) {
    const src = await uploadFile(file);
    project.documents.push({ name: file.name, src });
  }
  renderDocs(project);
  event.target.value = "";
};

$("publish").onclick = async () => {
  readProfile();
  if (state.projectIndex >= 0 && $("sheet").open) readProjectFields();
  state.content.skills.marqueeA = splitList($("skills-a").value);
  state.content.skills.marqueeB = splitList($("skills-b").value);
  setStatus("Publishing…");
  try {
    await api("/content", { method: "PUT", body: state.content });
    setStatus("Live");
  } catch (error) {
    setStatus(error.message);
  }
};

async function start() {
  state.api = await resolveApi();
  if (!state.api) {
    $("login-err").hidden = false;
    $("login-err").textContent = "The studio API is not connected yet.";
  }
  if (state.token && state.api) {
    try {
      await loadDesk();
    } catch {
      signOut();
    }
  }
}

start();
