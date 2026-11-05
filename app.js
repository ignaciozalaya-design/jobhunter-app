// App de JobHunter: lee y escribe los datos del repositorio privado a través de la API de GitHub.
const OWNER = "ignaciozalaya-design";
const REPO = "jobhunter";
const BRANCH = "main";
const WORKFLOW = "jobhunter.yml";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const STATUS_LABELS = {
  easy_apply: "Postulate vos (Easy Apply)",
  pendiente: "Pendiente de postular",
  postulando: "Postulando… (tarda unos minutos)",
  postulada: "Postulada automáticamente",
  simulada: "Formulario completado (modo prueba)",
  revisar: "No pude postular: hacelo vos",
  postulada_manual: "Te postulaste",
  descartada: "Descartada",
  baja: "Bajo fit",
};

const $ = (s) => document.querySelector(s);
const state = {
  day: new URLSearchParams(location.search).get("day"),
  filter: "all", jobs: {}, overrides: {}, meta: {}, open: new Set(), local: {},
};

const FILTERS = {
  all: () => true,
  mine: (j) => ["easy_apply", "revisar"].includes(j.status),
  applied: (j) => ["postulada", "postulada_manual"].includes(j.status),
  pending: (j) => ["pendiente", "postulando", "simulada"].includes(j.status),
};

function getToken() { try { return localStorage.getItem("jh_token") || ""; } catch { return ""; } }
function setToken(t) { try { t ? localStorage.setItem("jh_token", t) : localStorage.removeItem("jh_token"); } catch {} }

async function gh(path, opts = {}) {
  const r = await fetch(path.startsWith("http") ? path : API + path, {
    cache: "no-store",
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401) { showLogin("La clave no es válida o venció"); throw new Error("401"); }
  return r;
}

async function readJson(file, fallback) {
  const r = await gh(`/contents/data/${file}?ref=${BRANCH}&t=${Date.now()}`, { headers: { Accept: "application/vnd.github.raw+json" } });
  if (r.status === 404) return fallback;
  if (!r.ok) throw new Error(`No pude leer ${file} (${r.status})`);
  return r.json();
}

function b64utf8(str) { return btoa(String.fromCharCode(...new TextEncoder().encode(str))); }
function utf8b64(b64) { return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0))); }

async function saveOverride(id, status) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await gh(`/contents/data/overrides.json?ref=${BRANCH}&t=${Date.now()}`);
    let sha, data = {};
    if (r.ok) { const f = await r.json(); sha = f.sha; data = JSON.parse(utf8b64(f.content) || "{}"); }
    data[id] = { status, at: new Date().toISOString() };
    const put = await gh(`/contents/data/overrides.json`, {
      method: "PUT",
      body: JSON.stringify({ message: `App: ${id} → ${status}`, content: b64utf8(JSON.stringify(data, null, 1)), sha, branch: BRANCH }),
    });
    if (put.ok) { state.overrides = data; return; }
    if (![409, 422].includes(put.status)) throw new Error(`No pude guardar (${put.status})`);
  }
  throw new Error("No pude guardar, probá de nuevo");
}

async function dispatch(inputs) {
  const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: BRANCH, inputs }),
  });
  if (r.status !== 204) throw new Error(`No pude iniciar la tarea (${r.status})`);
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function fmtDay(d, today) {
  if (d === today) return "Hoy";
  const dt = new Date(d + "T12:00:00");
  const diff = Math.round((new Date(today + "T12:00:00") - dt) / 864e5);
  if (diff === 1) return "Ayer";
  return dt.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

function showLogin(msg) {
  $("#app").hidden = true; $("#login").hidden = false;
  $("#loginError").textContent = msg || "";
}

function effective(j) {
  const status = state.local[j.id] || state.overrides[j.id]?.status || j.status;
  return { ...j, status, status_label: STATUS_LABELS[status] || status };
}

function visibleJobs() {
  return Object.values(state.jobs).map(effective).filter((j) => j.status !== "baja");
}

async function load() {
  const [jobs, overrides, meta] = await Promise.all([
    readJson("jobs.json", {}), readJson("overrides.json", {}), readJson("meta.json", {}),
  ]);
  state.jobs = jobs; state.overrides = overrides; state.meta = meta;
  $("#login").hidden = true; $("#app").hidden = false;
  render();
}

function renderHeader() {
  const today = todayAR();
  if (!state.day) state.day = today;
  const counts = {};
  for (const j of visibleJobs()) if (j.status !== "descartada") counts[j.found_day] = (counts[j.found_day] || 0) + 1;
  const days = [...new Set([today, ...Object.keys(counts)])].sort().reverse().slice(0, 30);
  $("#days").innerHTML = days.map((d) =>
    `<button data-day="${d}" class="${d === state.day ? "on" : ""}">${fmtDay(d, today)}<small>${counts[d] || 0}</small></button>`
  ).join("");
  $("#dryBanner").hidden = !state.meta.dry_run;
  const r = state.meta.last_run;
  $("#lastRun").textContent = r
    ? `Última búsqueda: ${new Date(r.finished_at || r.started_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` +
      (r.error ? " · ⚠️ " + r.error : ` · ${r.found} nuevas`)
    : "Todavía no corrió ninguna búsqueda";
}

function fitClass(f) { return f >= 80 ? "good" : f >= 65 ? "mid" : "low"; }

function actions(j) {
  const a = [];
  if (j.apply_type !== "external") {
    a.push(`<a class="primary" href="${esc(j.url)}" target="_blank" rel="noopener">Postularme en LinkedIn</a>`);
  } else {
    a.push(`<a href="${esc(j.url)}" target="_blank" rel="noopener">Ver en LinkedIn</a>`);
    if (j.external_url) a.push(`<a ${j.status === "revisar" ? 'class="primary"' : ""} href="${esc(j.external_url)}" target="_blank" rel="noopener">Abrir formulario</a>`);
    if (["pendiente", "revisar", "simulada"].includes(j.status)) a.push(`<button data-act="apply">Postular ahora</button>`);
  }
  if (j.screenshot) a.push(`<button data-act="shot">Ver captura</button>`);
  if (!["postulada", "postulada_manual"].includes(j.status)) a.push(`<button data-act="done">Ya me postulé</button>`);
  if (j.status !== "descartada") a.push(`<button data-act="discard">Descartar</button>`);
  return a.join("");
}

function card(j) {
  const open = state.open.has(j.id);
  const tags = [j.location, j.modality, j.apply_type === "external" ? "Link externo" : "Easy Apply"].filter(Boolean);
  return `<article class="card" data-id="${j.id}">
    <div class="card-head">
      <div class="fit ${fitClass(j.fit)}" aria-label="Fit ${j.fit}%">${j.fit}%</div>
      <div class="info">
        <p class="title">${esc(j.title)}</p>
        <p class="company">${esc(j.company)}</p>
        <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
    </div>
    <span class="status st-${j.status}">${esc(j.status_label)}</span>
    ${j.status_detail && !["easy_apply", "postulada_manual", "descartada"].includes(j.status) ? `<p class="detail-note">${esc(j.status_detail)}</p>` : ""}
    <div class="more" ${open ? "" : "hidden"}>
      <p class="summary">${esc(j.summary)}</p>
      <div class="req">
        <h3>Cumplís</h3><ul>${(j.met || []).map((m) => `<li class="ok">${esc(m)}</li>`).join("") || "<li>—</li>"}</ul>
        <h3>No cumplís</h3><ul>${(j.unmet || []).map((m) => `<li class="no">${esc(m)}</li>`).join("") || "<li>—</li>"}</ul>
      </div>
      <div class="actions">${actions(j)}</div>
    </div>
    <button class="toggle" data-act="toggle">${open ? "Ver menos" : "Ver resumen y requisitos"}</button>
  </article>`;
}

function render() {
  renderHeader();
  const list = visibleJobs()
    .filter((j) => j.found_day === state.day)
    .filter(FILTERS[state.filter])
    .sort((a, b) => (b.fit || 0) - (a.fit || 0));
  $("#list").innerHTML = list.map(card).join("");
  $("#empty").hidden = list.length > 0;
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === state.filter));
}

async function showShot(id) {
  const j = state.jobs[id];
  const r = await gh(`/contents/data/${j.screenshot}?ref=${BRANCH}`, { headers: { Accept: "application/vnd.github.raw+json" } });
  if (!r.ok) return toast("La captura todavía no está disponible");
  const d = $("#shot"); d.querySelector("img").src = URL.createObjectURL(await r.blob()); d.showModal();
}

$("#list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === "toggle") { state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); }
    if (act === "done") { state.local[id] = "postulada_manual"; render(); await saveOverride(id, "postulada_manual"); toast("Marcada como postulada"); }
    if (act === "discard") { state.local[id] = "descartada"; render(); await saveOverride(id, "descartada"); toast("Descartada"); }
    if (act === "apply") {
      await dispatch({ accion: "postular", job_id: id });
      state.local[id] = "postulando"; render();
      toast("Postulando… volvé en unos minutos");
    }
    if (act === "shot") await showShot(id);
  } catch (err) {
    delete state.local[id]; render();
    if (err.message !== "401") toast("Error: " + err.message);
  }
});

$("#days").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.day = b.dataset.day; history.replaceState(null, "", `?day=${state.day}`); render();
});
$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.filter = b.dataset.f; render();
});
$("#runBtn").addEventListener("click", async () => {
  const b = $("#runBtn"); b.classList.add("spin");
  try {
    await dispatch({ accion: "buscar", job_id: "" });
    toast("Buscando posiciones nuevas… tarda entre 10 y 30 minutos");
  } catch (err) { if (err.message !== "401") toast("Error: " + err.message); }
  setTimeout(() => b.classList.remove("spin"), 3000);
});
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setToken($("#password").value.trim());
  const r = await gh("").catch(() => null);
  if (!r || !r.ok) { setToken(""); return showLogin("No pude entrar con esa clave. Revisá que tenga acceso al repositorio jobhunter."); }
  start();
});

async function start() {
  if (!getToken()) return showLogin();
  try { await load(); } catch (e) { if (e.message !== "401") toast("Error: " + e.message); }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#app").hidden) start(); });
start();
