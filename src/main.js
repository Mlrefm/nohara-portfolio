import "./styles.css";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const RAW_PUBLIC = "https://raw.githubusercontent.com/Mlrefm/nohara-portfolio/main/public";

/** Prefer raw.githubusercontent so Studio publishes appear in seconds, not after Pages rebuild. */
const asset = (p) => {
  if (!p) return p;
  if (/^https?:\/\//.test(p) || p.startsWith("blob:")) return p;
  const path = p.startsWith("/") ? p : `/${p}`;
  if (
    path.startsWith("/uploads/") ||
    path.startsWith("/stills/") ||
    path.startsWith("/clips/") ||
    path === "/portrait.jpeg" ||
    /\.pdf$/i.test(path)
  ) {
    return `${RAW_PUBLIC}${path}`;
  }
  if (path.startsWith("/")) return BASE + path;
  return `${BASE}/${path}`;
};

let projects = [];
let skillsA = [];
let skillsB = [];
let words = ["Architect", "Architectural Designer", "AI in Architecture Researcher"];

async function loadContent() {
  const urls = [];
  if (import.meta.env.VITE_ADMIN_API) urls.push(`${import.meta.env.VITE_ADMIN_API.replace(/\/$/, "")}/content`);
  let owner = "Mlrefm";
  let repo = "nohara-portfolio";
  let branch = "main";
  try {
    const config = await fetch(`${BASE}/admin-config.json`, { cache: "no-store" });
    if (config.ok) {
      const data = await config.json();
      if (data.api) urls.unshift(`${String(data.api).replace(/\/$/, "")}/content`);
      if (data.github?.owner) owner = data.github.owner;
      if (data.github?.repo) repo = data.github.repo;
      if (data.github?.branch) branch = data.github.branch;
    }
  } catch {
    /* defaults are fine */
  }
  // Raw first: updates show seconds after Publish, without waiting for Pages.
  urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/public/content.json?t=${Date.now()}`);
  urls.push(`${BASE}/content.json`);
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

function applyMedia(project) {
  project.cover = asset(project.cover);
  project.images = (project.images || []).map(asset);
  project.videos = (project.videos || []).map((clip) => ({
    ...clip,
    src: asset(clip.src),
    poster: asset(clip.poster),
  }));
  project.documents = (project.documents || []).map((doc) => ({ ...doc, src: asset(doc.src) }));
  return project;
}

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const $ = (selector) => document.querySelector(selector);
const intro = $("#intro");
const scene = $("#scene");
const sceneCtx = scene.getContext("2d");
const chapterBox = $("#chapter");
const chapterKicker = $("#chapter-kicker");
const chapterTitle = $("#chapter-title");
const chapterText = $("#chapter-text");
const hudPercent = $("#hud-percent");
const calloutLeft = $("#callout-left");
const calloutRight = $("#callout-right");
const nav = $("#nav");
const progressBar = $("#progress");
const glow = $("#glow");
const fan = $("#fan");
const dots = $("#dots");
const dialog = $("#detail");
const detailMedia = $("#detail-media");
const still = $("#detail-still");
const video = $("#detail-video");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smooth(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function progressOf(section) {
  const total = section.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return clamp(-section.getBoundingClientRect().top / total, 0, 1);
}

/* Intro scene */

const chapters = [
  { from: 0, to: 0.14, kicker: "00 · Site", title: "Nohara Odeesh", text: "Scroll to build the project" },
  { from: 0.14, to: 0.32, kicker: "01 · Plan", title: "Plan", text: "Footprint, grid, and columns set on the ground" },
  { from: 0.32, to: 0.52, kicker: "02 · Structure", title: "Structure", text: "Columns rise and beams tie the frame" },
  { from: 0.52, to: 0.74, kicker: "03 · Mass", title: "Mass", text: "Stepped terraces, after the ziggurat" },
  { from: 0.74, to: 0.9, kicker: "04 · Facade", title: "Facade", text: "Vertical fins for shade and rhythm" },
  { from: 0.9, to: 1.01, kicker: "05 · Enter", title: "Nohara Yousif Odeesh", text: "Architect · Architectural Designer" },
];

const callouts = [
  { from: 0.13, to: 0.33, side: "left", label: "Site grid", sub: "Setting-out lines" },
  { from: 0.31, to: 0.53, side: "right", label: "Structure", sub: "Eight columns, three slabs" },
  { from: 0.51, to: 0.75, side: "left", label: "Terraces", sub: "Each floor steps back" },
  { from: 0.73, to: 0.91, side: "right", label: "Fins", sub: "Vertical shading" },
];

const pointer = { x: 0, y: 0 };
const camera = { yaw: 0, pitch: 0 };
let chapterIndex = -1;
const dust = Array.from({ length: 70 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.6 + Math.random() * 1.1,
  v: 0.00012 + Math.random() * 0.00025,
  a: 0.15 + Math.random() * 0.35,
}));

const COLUMNS = [];
for (const x of [-3.2, -1.07, 1.07, 3.2]) for (const z of [-1.8, 1.8]) COLUMNS.push([x, z]);
const FLOORS = [
  { y: 1.1, inset: 0 },
  { y: 2.2, inset: 0.7 },
  { y: 3.3, inset: 1.5 },
];

function project(point, unit, cx, cy) {
  const [x, y, z] = point;
  const cosY = Math.cos(camera.yaw);
  const sinY = Math.sin(camera.yaw);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;
  const cosP = Math.cos(camera.pitch);
  const sinP = Math.sin(camera.pitch);
  const y2 = y * cosP - z1 * sinP;
  const z2 = y * sinP + z1 * cosP;
  return [cx + x1 * unit, cy - y2 * unit, z2];
}

const nodes = [];

function drawScene(progress, after, time) {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, scene.clientWidth);
  const height = Math.max(1, scene.clientHeight);
  if (scene.width !== Math.round(width * ratio) || scene.height !== Math.round(height * ratio)) {
    scene.width = Math.round(width * ratio);
    scene.height = Math.round(height * ratio);
  }
  const ctx = sceneCtx;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const p = reduced ? 1 : progress;
  // `after` runs 0 -> 1 across the rest of the page once the intro is complete,
  // so the model keeps orbiting slowly behind the content.
  const idle = reduced ? 0 : Math.sin(time * 0.00025) * 0.05;
  const targetYaw = -0.75 + p * 1.35 + after * 1.9 + pointer.x * 0.28 + idle;
  const targetPitch = 0.44 + after * 0.12 + pointer.y * 0.14;
  camera.yaw += (targetYaw - camera.yaw) * 0.08;
  camera.pitch += (targetPitch - camera.pitch) * 0.08;
  const settle = smooth(0, 0.12, after);
  const base = width < height ? width / (10.5 - p * 1.5) : Math.min(width, height) / (14.5 - p * 2.2);
  const unit = base * (1 - settle * 0.18);
  const cx = width * 0.5 + pointer.x * -12;
  const cy = height * (0.46 + settle * 0.1) + unit * 1.1 + pointer.y * -8;
  const dim = 1 - settle * 0.6;
  const P = (x, y, z) => project([x, y, z], unit, cx, cy);
  nodes.length = 0;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ambient light pool under the model
  const pool = ctx.createRadialGradient(cx, cy - unit * 0.6, 0, cx, cy - unit * 0.6, unit * 6);
  pool.addColorStop(0, `rgba(212, 175, 106, ${0.09 * dim})`);
  pool.addColorStop(1, "rgba(212, 175, 106, 0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f0d9a6";
  for (const mote of dust) {
    mote.y -= mote.v * (reduced ? 0 : 1);
    if (mote.y < -0.02) mote.y = 1.02;
    const twinkle = 0.6 + 0.4 * Math.sin(time * 0.001 + mote.x * 20);
    ctx.globalAlpha = mote.a * twinkle * 0.5 * dim;
    ctx.beginPath();
    ctx.arc(mote.x * width, mote.y * height, mote.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const line = (a, b, t = 1, alpha = 1, w = 1, color = "#f0d9a6") => {
    if (t <= 0) return;
    const ax = a[0];
    const ay = a[1];
    const bx = ax + (b[0] - ax) * t;
    const by = ay + (b[1] - ay) * t;
    const depth = clamp(0.62 + ((a[2] + b[2]) / 2) * 0.09, 0.3, 1);
    ctx.strokeStyle = color;
    if (w >= 1.4) {
      ctx.globalAlpha = alpha * depth * dim * 0.16;
      ctx.lineWidth = w * 4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * depth * dim;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const node = (a, r = 2.2, alpha = 0.9, track = true) => {
    ctx.globalAlpha = alpha * dim;
    ctx.fillStyle = "#f0d9a6";
    ctx.beginPath();
    ctx.arc(a[0], a[1], r, 0, Math.PI * 2);
    ctx.fill();
    if (track) nodes.push(a);
  };
  const fill = (points, alpha) => {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha * dim;
    ctx.fillStyle = "#d4af6a";
    ctx.beginPath();
    points.forEach((point, index) => (index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])));
    ctx.closePath();
    ctx.fill();
  };
  const dimension = (a, b, offsetX, offsetZ, t, alpha) => {
    if (t <= 0 || alpha <= 0) return;
    const a2 = P(a[0] + offsetX, 0, a[1] + offsetZ);
    const b2 = P(b[0] + offsetX, 0, b[1] + offsetZ);
    line(a2, b2, t, alpha, 1, "#a39d92");
    line(P(a[0], 0, a[1]), a2, t, alpha * 0.7, 1, "#a39d92");
    line(P(b[0], 0, b[1]), b2, t, alpha * 0.7, 1, "#a39d92");
    const tick = (q) => {
      ctx.globalAlpha = alpha * dim;
      ctx.strokeStyle = "#a39d92";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q[0] - 4, q[1] + 4);
      ctx.lineTo(q[0] + 4, q[1] - 4);
      ctx.stroke();
    };
    tick(a2);
    if (t >= 1) tick(b2);
  };

  const grid = smooth(0, 0.16, p);
  ctx.lineWidth = 1;
  for (let i = -7; i <= 7; i += 1) {
    const reach = clamp(grid * 1.6 - Math.abs(i) / 9, 0, 1);
    line(P(i, 0, -5), P(i, 0, 5), reach, 0.1 + 0.08 * (1 - Math.abs(i) / 7), 1, "#a39d92");
  }
  for (let j = -5; j <= 5; j += 1) {
    const reach = clamp(grid * 1.6 - Math.abs(j) / 7, 0, 1);
    line(P(-7, 0, j), P(7, 0, j), reach, 0.1 + 0.08 * (1 - Math.abs(j) / 5), 1, "#a39d92");
  }
  const boundary = [P(-6, 0, -4), P(6, 0, -4), P(6, 0, 4), P(-6, 0, 4)];
  boundary.forEach((corner, index) => {
    const next = boundary[(index + 1) % 4];
    line(corner, next, clamp(grid * 4 - index, 0, 1), 0.32, 1, "#d4af6a");
  });

  const planIn = smooth(0.13, 0.32, p);
  const footprint = [
    [-4, -2.5],
    [4, -2.5],
    [4, 2.5],
    [-4, 2.5],
  ];
  fill(
    footprint.map(([x, z]) => P(x, 0, z)),
    0.06 * smooth(0.6, 1, planIn),
  );
  footprint.forEach((corner, index) => {
    const next = footprint[(index + 1) % 4];
    line(P(corner[0], 0, corner[1]), P(next[0], 0, next[1]), clamp(planIn * 4 - index, 0, 1), 0.95, 1.6);
  });
  const structIn = smooth(0.31, 0.53, p);
  const dimAlpha = 0.5 * (1 - structIn);
  dimension([-4, 2.5], [4, 2.5], 0, 0.9, clamp(planIn * 3 - 1.6, 0, 1), dimAlpha);
  dimension([4, -2.5], [4, 2.5], 0.9, 0, clamp(planIn * 3 - 2, 0, 1), dimAlpha);
  const walls = [
    [[-1.07, -2.5], [-1.07, 0.6]],
    [[-4, 0.6], [-1.07, 0.6]],
    [[1.07, -2.5], [1.07, -0.4]],
    [[1.07, -0.4], [4, -0.4]],
    [[-2.2, 2.5], [-2.2, 1.2]],
  ];
  walls.forEach(([a, b], index) => {
    line(P(a[0], 0, a[1]), P(b[0], 0, b[1]), clamp(planIn * 6 - 1.5 - index * 0.7, 0, 1), 0.55, 1);
  });
  if (planIn > 0.7) COLUMNS.forEach(([x, z]) => node(P(x, 0, z), 2.4, (planIn - 0.7) / 0.3));

  COLUMNS.forEach(([x, z], index) => {
    const t = clamp(structIn * 2.2 - index * 0.12, 0, 1);
    const top = Math.abs(x) > 2 ? 1.1 : 3.3;
    line(P(x, 0, z), P(x, top, z), t, 0.9, 1.5);
    if (t >= 1) node(P(x, top, z), 1.8, 0.8);
  });
  const beamsIn = clamp((structIn - 0.55) / 0.45, 0, 1);
  for (const z of [-1.8, 1.8]) {
    line(P(-3.2, 1.1, z), P(3.2, 1.1, z), beamsIn, 0.6, 1);
  }
  for (const x of [-3.2, -1.07, 1.07, 3.2]) {
    line(P(x, 1.1, -1.8), P(x, 1.1, 1.8), clamp(beamsIn * 1.3 - 0.3, 0, 1), 0.6, 1);
  }

  const massIn = smooth(0.5, 0.76, p);
  FLOORS.forEach((floor, index) => {
    const t = clamp(massIn * 3 - index, 0, 1);
    if (t <= 0) return;
    const y = floor.y * (0.6 + 0.4 * t);
    const ring = [
      [-4 + floor.inset, -2.5 + floor.inset * 0.3],
      [4 - floor.inset, -2.5 + floor.inset * 0.3],
      [4 - floor.inset, 2.5 - floor.inset * 0.3],
      [-4 + floor.inset, 2.5 - floor.inset * 0.3],
    ];
    fill(
      ring.map(([x, z]) => P(x, y, z)),
      0.045 * smooth(0.7, 1, t),
    );
    ring.forEach((corner, cornerIndex) => {
      const next = ring[(cornerIndex + 1) % 4];
      line(P(corner[0], y, corner[1]), P(next[0], y, next[1]), clamp(t * 4 - cornerIndex, 0, 1), 0.92, 1.6);
      if (t >= 1) node(P(corner[0], y, corner[1]), 1.6, 0.7);
    });
    if (index > 0 && t >= 1) {
      const lower = FLOORS[index - 1];
      for (const corner of ring) {
        line(P(corner[0], lower.y, corner[1]), P(corner[0], y, corner[1]), 1, 0.5, 1);
      }
    }
  });

  const facadeIn = smooth(0.73, 0.92, p);
  if (facadeIn > 0) {
    const count = 15;
    for (let i = 0; i <= count; i += 1) {
      const x = -4 + (8 / count) * i;
      const t = clamp(facadeIn * (count + 4) - i, 0, 1);
      line(P(x, 0, 2.5), P(x, 1.1, 2.5), t, 0.75, 1, "#f3eee4");
    }
    const terraceT = clamp(facadeIn * 1.6 - 0.6, 0, 1);
    for (const floor of FLOORS.slice(0, 2)) {
      const z = 2.5 - floor.inset * 0.3;
      const x0 = -4 + floor.inset;
      const x1 = 4 - floor.inset;
      line(P(x0, floor.y + 0.3, z), P(x1, floor.y + 0.3, z), terraceT, 0.45, 1, "#f3eee4");
    }
  }

  const finalIn = smooth(0.88, 1, p);
  if (finalIn > 0) {
    // The sun keeps travelling across the sky as the visitor reads the rest of the page.
    const angle = Math.PI * (0.12 + finalIn * 0.3 + after * 0.5);
    const sun = P(Math.cos(angle) * 8, 1 + Math.sin(angle) * 5.5, -1);
    ctx.globalAlpha = 0.9 * finalIn * dim;
    const halo = ctx.createRadialGradient(sun[0], sun[1], 0, sun[0], sun[1], unit * 1.6);
    halo.addColorStop(0, "rgba(240, 217, 166, 0.5)");
    halo.addColorStop(1, "rgba(240, 217, 166, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sun[0], sun[1], unit * 1.6, 0, Math.PI * 2);
    ctx.fill();
    node(sun, 5, finalIn, false);
  }

  // Pointer focus: the vertex nearest the cursor lights up with a target ring.
  if (finePointer && !reduced && nodes.length) {
    const mx = mouse.x;
    const my = mouse.y;
    let best = null;
    let bestDist = 70;
    for (const point of nodes) {
      const d = Math.hypot(point[0] - mx, point[1] - my);
      if (d < bestDist) {
        bestDist = d;
        best = point;
      }
    }
    if (best) {
      const pulse = 1 + 0.12 * Math.sin(time * 0.006);
      const strength = 1 - bestDist / 70;
      ctx.globalAlpha = (0.35 + 0.55 * strength) * dim;
      ctx.strokeStyle = "#f0d9a6";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(best[0], best[1], 11 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(best[0] + dx * 15 * pulse, best[1] + dy * 15 * pulse);
        ctx.lineTo(best[0] + dx * 22 * pulse, best[1] + dy * 22 * pulse);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.25 * strength * dim;
      ctx.beginPath();
      ctx.moveTo(best[0], best[1]);
      ctx.lineTo(mx, my);
      ctx.stroke();
      node(best, 3.2, 1, false);
    }
  }

  ctx.globalAlpha = 1;
}

function updateChapter(progress) {
  const p = reduced ? 1 : progress;
  const index = chapters.findIndex((chapter) => p >= chapter.from && p < chapter.to);
  const next = index < 0 ? chapters.length - 1 : index;
  if (next !== chapterIndex) {
    chapterIndex = next;
    const chapter = chapters[next];
    chapterKicker.textContent = chapter.kicker;
    chapterTitle.textContent = chapter.title;
    chapterText.textContent = chapter.text;
    chapterBox.classList.remove("is-switching");
    void chapterBox.offsetWidth;
    chapterBox.classList.add("is-switching");
  }
  hudPercent.textContent = String(Math.round(p * 100));
  for (const side of ["left", "right"]) {
    const box = side === "left" ? calloutLeft : calloutRight;
    const hit = callouts.find((callout) => callout.side === side && p >= callout.from && p < callout.to);
    if (hit) {
      box.querySelector("b").textContent = hit.label;
      box.querySelector("span").textContent = hit.sub;
    }
    box.classList.toggle("is-on", Boolean(hit));
  }
}

/* Rotating word */

let wordIndex = 0;
const rotateBox = $("#rotate-word").parentElement;
if (!reduced) {
  window.setInterval(() => {
    if (!words.length) return;
    wordIndex = (wordIndex + 1) % words.length;
    const span = document.createElement("span");
    span.textContent = words[wordIndex];
    rotateBox.replaceChildren(span);
  }, 2600);
}

function revealWords() {
  document.querySelectorAll(".reveal").forEach((element) => {
    if (element.dataset.revealed) return;
    const parts = element.textContent.trim().split(/\s+/);
    element.replaceChildren(
      ...parts.map((word, index) => {
        const span = document.createElement("span");
        span.style.setProperty("--i", String(index));
        span.textContent = word;
        return span;
      }),
    );
    element.classList.add("scroll-words");
    element.dataset.revealed = "1";
  });
}

/* Portrait tilt */

const portrait = $("#portrait");
if (finePointer && !reduced) {
  portrait.addEventListener("pointermove", (event) => {
    const rect = portrait.getBoundingClientRect();
    const rx = ((event.clientY - rect.top) / rect.height - 0.5) * -12;
    const ry = ((event.clientX - rect.left) / rect.width - 0.5) * 12;
    portrait.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  });
  portrait.addEventListener("pointerleave", () => {
    portrait.style.transform = "";
  });
}

const timelineObserver = new IntersectionObserver(
  (entries) => {
    const items = [...document.querySelectorAll("#timeline li")];
    for (const entry of entries) {
      if (entry.isIntersecting) items.forEach((item) => item.classList.toggle("is-current", item === entry.target));
    }
  },
  { rootMargin: "-30% 0px -50% 0px", threshold: 0 },
);

/* Marquees */

function fillMarquee(track, items) {
  track.replaceChildren(
    ...[...items, ...items].map((item) => {
      const span = document.createElement("span");
      span.textContent = item;
      return span;
    }),
  );
}
let active = 0;
let fanPos = 0;
let drag = null;
let suppressClick = false;
let cards = [];
let dotButtons = [];

function buildFan() {
  fan.replaceChildren();
  dots.replaceChildren();
  active = Math.floor(projects.length / 2);
  fanPos = active;
  cards = projects.map((project, index) => {
  const button = document.createElement("button");
  button.type = "button";
  const plate = project.plate || !project.cover;
  button.className = `card${plate ? " plate" : ""}`;
  button.setAttribute("role", "listitem");
  button.setAttribute("aria-label", `Open ${project.title}`);
  const number = String(index + 1).padStart(2, "0");
  if (plate) {
    button.innerHTML = `<span class="frame"></span><span class="num">${number}</span><span class="copy"><span class="kind">${project.kind}</span><strong>${project.title}</strong><span class="rule"></span><em>${project.year}</em></span><span class="lines">${project.lines}</span>`;
  } else {
    button.innerHTML = `<img alt="" src="${project.cover}" draggable="false" ${project.pos ? `style="object-position:${project.pos}"` : ""} /><span class="shade"></span><span class="num">${number}</span><span class="copy"><span class="kind">${project.kind}</span><strong>${project.title}</strong><span class="rule"></span><em>${project.year}</em></span>`;
  }
  button.addEventListener("pointermove", (event) => {
    const rect = button.getBoundingClientRect();
    button.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    button.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  });
  button.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setActive(index);
    openProject(index, button);
  });
  fan.append(button);
  return button;
  });

  dotButtons = projects.map((project, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Show ${project.title}`);
    button.addEventListener("click", () => setActive(index));
    dots.append(button);
    return button;
  });
  layoutFan();
}

function layoutFan() {
  const count = cards.length;
  cards.forEach((card, index) => {
    const delta = index - fanPos;
    const abs = Math.abs(delta);
    const focus = abs < 0.5;
    const scale = focus ? 1.06 - abs * 0.1 : 0.98 - abs * 0.06;
    const lift = focus ? -46 * (1 - abs * 2) : 0;
    const spread = window.innerWidth < 640 ? 18 : 42;
    card.style.transform = `translate(-50%, -50%) translateX(${(delta * spread).toFixed(1)}px) rotate(${(delta * 8).toFixed(2)}deg) translateY(${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    card.style.zIndex = String(Math.round(100 - abs * 10));
    card.style.opacity = abs > 3.4 ? "0" : "1";
    card.style.filter = `brightness(${(1 - Math.min(abs, 3) * 0.14).toFixed(3)})`;
    card.classList.toggle("is-active", Math.round(fanPos) === index);
    card.tabIndex = Math.round(fanPos) === index ? 0 : -1;
  });
  dotButtons.forEach((dot, index) => dot.classList.toggle("is-active", index === Math.round(fanPos)));
  void count;
}

function setActive(index) {
  active = clamp(index, 0, cards.length - 1);
  fanPos = active;
  layoutFan();
}

$("#prev").addEventListener("click", () => setActive(active - 1));
$("#next").addEventListener("click", () => setActive(active + 1));
fan.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") setActive(active - 1);
  if (event.key === "ArrowRight") setActive(active + 1);
});

fan.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  drag = { x: event.clientX, pos: fanPos, id: event.pointerId };
  fan.classList.add("is-dragging");
  cards.forEach((card) => (card.style.transition = "none"));
});

fan.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  if (Math.abs(dx) > 6) suppressClick = true;
  fanPos = clamp(drag.pos - dx / 140, -0.4, cards.length - 0.6);
  layoutFan();
});

function endDrag() {
  if (!drag) return;
  drag = null;
  fan.classList.remove("is-dragging");
  cards.forEach((card) => (card.style.transition = ""));
  setActive(Math.round(fanPos));
  window.setTimeout(() => (suppressClick = false), 0);
}
fan.addEventListener("pointerup", endDrag);
fan.addEventListener("pointercancel", endDrag);
fan.addEventListener("pointerleave", endDrag);

/* Project detail */

let clips = [];
let clipIndex = 0;

function stopVideo() {
  video.pause();
  video.onended = null;
  video.onloadedmetadata = null;
  video.removeAttribute("src");
  video.load();
  detailMedia.classList.remove("is-video");
}

function playClips(list) {
  clips = list;
  clipIndex = 0;
  const run = () => {
    const clip = clips[clipIndex];
    if (!clip) return;
    video.onloadedmetadata = () => {
      const start = Math.min(clip.start, Math.max(0, (video.duration || clip.start) - 0.2));
      if (start > 0) video.currentTime = start;
      video.play().catch(() => {});
    };
    video.onended = () => {
      clipIndex = (clipIndex + 1) % clips.length;
      run();
    };
    video.poster = clip.poster || "";
    video.src = clip.src;
  };
  detailMedia.classList.add("is-video");
  run();
}

function showImage(src) {
  stopVideo();
  still.src = src;
}

function openProject(index, card) {
  const project = projects[index];
  $("#detail-title").textContent = project.title;
  $("#detail-meta").textContent = `${project.kind} · ${project.year}`;
  $("#detail-text").textContent = project.text;
  const facts = $("#detail-facts");
  facts.replaceChildren(
    ...project.facts.flatMap(([key, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );

  const thumbs = $("#detail-thumbs");
  const entries = [];
  if (project.videos?.length) entries.push({ type: "video", poster: project.videos[0].poster });
  for (const src of project.images || []) entries.push({ type: "image", src });
  thumbs.replaceChildren(
    ...entries.map((entry, entryIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<img alt="" src="${entry.type === "video" ? entry.poster : entry.src}" />${entry.type === "video" ? '<span class="play">Play</span>' : ""}`;
      button.setAttribute("aria-label", entry.type === "video" ? `Play ${project.title} film` : `${project.title} image ${entryIndex + 1}`);
      button.addEventListener("click", () => {
        thumbs.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
        if (entry.type === "video") playClips(project.videos);
        else showImage(entry.src);
      });
      return button;
    }),
  );
  thumbs.hidden = entries.length < 2;
  if (thumbs.firstChild) thumbs.firstChild.classList.add("is-active");

  stopVideo();
  still.src = project.cover || (project.images[0] ?? "");
  still.style.objectPosition = project.pos || "";
  const textOnly = !project.cover && !(project.images || []).length && !(project.videos || []).length;
  detailMedia.hidden = textOnly;
  dialog.classList.toggle("text-only", textOnly);

  dialog.showModal();
  const rect = card.getBoundingClientRect();
  const box = dialog.getBoundingClientRect();
  dialog.style.setProperty("--ox", `${rect.left + rect.width / 2 - box.left}px`);
  dialog.style.setProperty("--oy", `${rect.top + rect.height / 2 - box.top}px`);
  dialog.scrollTop = 0;
  const docs = $("#detail-docs");
  const files = project.documents || [];
  docs.hidden = files.length === 0;
  docs.replaceChildren(
    ...files.map((doc) => {
      const link = document.createElement("a");
      link.href = doc.src;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = doc.name || "Document";
      return link;
    }),
  );

  if (project.videos && project.videos.length && !reduced) playClips(project.videos);
}

$("#close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", stopVideo);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

/* Nav, rail, glow, progress */

const sectionIds = ["about", "experience", "skills", "work", "contact"];
const navLinks = [...document.querySelectorAll(".nav nav a")];
const railLinks = [...document.querySelectorAll(".rail a")];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      navLinks.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`));
      railLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.rail === id));
    }
  },
  { rootMargin: "-40% 0px -50% 0px" },
);
sectionIds.forEach((id) => sectionObserver.observe(document.getElementById(id)));

const glowPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const mouse = { x: glowPos.x, y: glowPos.y };
if (finePointer && !reduced) {
  window.addEventListener("pointermove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  });
}

window.addEventListener("resize", layoutFan);

function tick(time) {
  const scrolled = document.documentElement.scrollHeight - window.innerHeight;
  progressBar.style.transform = `scaleX(${scrolled > 0 ? window.scrollY / scrolled : 0})`;
  const introBottom = intro.getBoundingClientRect().bottom;
  nav.classList.toggle("is-solid", introBottom < 70);
  const progress = progressOf(intro);
  const introEnd = intro.offsetHeight - window.innerHeight;
  const after = scrolled > introEnd ? clamp((window.scrollY - introEnd) / (scrolled - introEnd), 0, 1) : 0;
  drawScene(progress, after, time);
  if (introBottom > 0) {
    updateChapter(progress);
    intro.classList.toggle("is-moving", progress > 0.03);
  }
  if (finePointer && !reduced) {
    glowPos.x += (mouse.x - glowPos.x) * 0.12;
    glowPos.y += (mouse.y - glowPos.y) * 0.12;
    glow.style.transform = `translate3d(${glowPos.x}px, ${glowPos.y}px, 0)`;
  }
  requestAnimationFrame(tick);
}

function applySite(data) {
  if (!data) return;
  const site = data.site || {};
  if (site.hudLabel && $("#hud-label")) $("#hud-label").textContent = site.hudLabel;
  if (site.eyebrow) $("#site-eyebrow").textContent = site.eyebrow;
  if (site.nameHtml) $("#site-name").innerHTML = site.nameHtml;
  if (site.lede) $("#site-lede").textContent = site.lede;
  if (site.roles?.length) {
    words = site.roles;
    $("#rotate-word").textContent = words[0];
  }
  if (site.portrait) {
    const img = $("#portrait-img");
    img.src = asset(site.portrait);
    img.alt = site.portraitAlt || site.name || "";
  }
  if (site.portraitCaption) $("#portrait-caption").textContent = site.portraitCaption;
  const cv = site.cv ? asset(site.cv) : "";
  if (cv) {
    $("#cv-nav").href = cv;
    $("#cv-btn").href = cv;
  }
  if (site.email) {
    $("#mail").href = `mailto:${site.email}`;
    $("#mail").textContent = site.email;
  }
  if (site.phone) {
    $("#phone").href = site.phoneHref || `tel:${site.phone.replace(/\s+/g, "")}`;
    $("#phone").textContent = site.phone;
  }
  if (site.linkedin) $("#linkedin").href = site.linkedin;
  if (site.instagram) $("#instagram").href = site.instagram;
  if (site.location) $("#foot").textContent = site.location;
  if (site.workLede) $("#work-lede").textContent = site.workLede;

  if (data.experience) {
    $("#timeline").replaceChildren(
      ...data.experience.map((item) => {
        const li = document.createElement("li");
        li.innerHTML = `<p class="when"></p><h3></h3><p class="place"></p><p class="reveal"></p>`;
        li.querySelector(".when").textContent = item.when || "";
        li.querySelector("h3").textContent = item.title || "";
        li.querySelector(".place").textContent = item.place || "";
        li.querySelector(".reveal").textContent = item.text || "";
        return li;
      }),
    );
    document.querySelectorAll("#timeline li").forEach((item) => timelineObserver.observe(item));
  }

  if (data.skills) {
    skillsA = data.skills.marqueeA || [];
    skillsB = data.skills.marqueeB || [];
    fillMarquee($("#marquee-a"), skillsA);
    fillMarquee($("#marquee-b"), skillsB);
    if (data.skills.groups) {
      $("#skill-groups").replaceChildren(
        ...data.skills.groups.map((group) => {
          const div = document.createElement("div");
          div.innerHTML = `<h3></h3><p></p>`;
          div.querySelector("h3").textContent = group.title || "";
          div.querySelector("p").textContent = group.text || "";
          return div;
        }),
      );
    }
  }

  projects = (data.projects || []).map(applyMedia);
  buildFan();
  revealWords();
}

async function boot() {
  const data = await loadContent();
  applySite(data);
}

boot();
requestAnimationFrame(tick);
