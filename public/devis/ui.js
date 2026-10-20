/* Socle UI partagé : état, API, échappement HTML, icônes, toasts, modales, fichiers. */
export { fmtEUR, r2 } from "./pricing.js";

export const S = {
  pw: sessionStorage.getItem("devis_pw") || "",
  tok: localStorage.getItem("devis_tok") || "",
  settings: null, techniques: [], catalog: [], clients: [], quotes: [],
  mailEnabled: false, stripeEnabled: false,
};

/** Échappe toute valeur insérée dans du HTML (les textes clients ne sont jamais interprétés). */
export const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const num = v => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
export const clone = o => JSON.parse(JSON.stringify(o));

export const fmtDate = (t, withTime = false) => t ? new Date(t).toLocaleDateString("fr-FR", withTime
  ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
  : { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtNum = (n, d = 2) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d });
export const ago = t => {
  if (!t) return "—";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`;
  return fmtDate(t);
};

/* ---------- API ---------- */
export async function api(method, url, body) {
  const res = await fetch("/api/devis" + url, {
    method, headers: { "Content-Type": "application/json", ...(S.tok ? { "x-auth-token": S.tok } : { "x-admin-password": S.pw }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    sessionStorage.removeItem("devis_pw"); localStorage.removeItem("devis_tok");
    location.reload();
    throw new Error("Session expirée");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/** Vrai pour un compte employé (prix d'achat et marges masqués). */
export const isEmp = () => S.user && S.user.role !== "admin";

/* ---------- Icônes (traits SVG) ---------- */
const P = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shirt: '<path d="M20.4 6.6 16 3a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.2 1.3l1.9 3a1 1 0 0 0 1.3.4L8 10.5V20a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-9.5l1.4.8a1 1 0 0 0 1.3-.4l1.9-3a1 1 0 0 0-.2-1.3z"/>',
  brush: '<path d="M9.06 11.9 17.5 3.5a2.12 2.12 0 1 1 3 3l-8.44 8.44"/><path d="M7.07 14.94C5.4 14.94 4 16.3 4 18c0 1.3-1.5 2-2 2 1 1.5 3 2 4.5 2a4.48 4.48 0 0 0 4.5-4.5c0-1.7-1.3-2.56-3-2.56z"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  euro: '<path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trend: '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};
export const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

export const badge = (label, tone = "neutral", plain = false) => `<span class="badge t-${tone}${plain ? " plain" : ""}">${h(label)}</span>`;

/* ---------- Toasts ---------- */
export function toast(msg, type = "ok") {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `${icon(type === "err" ? "alert" : "check")}<span>${h(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === "err" ? 5000 : 2600);
}
export const fail = e => toast(e?.message || String(e), "err");

/* ---------- Modale ---------- */
export function modal({ title, body, size = "", actions = [], onOpen, dismiss = true }) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-h"><h2>${h(title)}</h2><button class="btn ghost icon" data-x aria-label="Fermer">${icon("x")}</button></div>
    <div class="modal-b">${body}</div>
    ${actions.length ? `<div class="modal-f">${actions.map((a, i) => `<button class="btn ${a.cls || ""}" data-a="${i}">${a.icon ? icon(a.icon) : ""}${h(a.label)}</button>`).join("")}</div>` : ""}
  </div>`;
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  bg.addEventListener("mousedown", e => { if (dismiss && e.target === bg) close(); });
  $("[data-x]", bg).onclick = close;
  actions.forEach((a, i) => {
    $(`[data-a="${i}"]`, bg).onclick = async e => {
      const btn = e.currentTarget;
      if (!a.onClick) return close();
      btn.disabled = true;
      try { if ((await a.onClick(bg, close)) !== false) close(); } catch (err) { fail(err); } finally { btn.disabled = false; }
    };
  });
  document.body.appendChild(bg);
  onOpen?.(bg, close);
  setTimeout(() => $("input:not([type=checkbox]),textarea,select", $(".modal-b", bg))?.focus(), 30);
  return { el: bg, close };
}

export function confirmBox(title, text, { label = "Confirmer", danger = false } = {}) {
  return new Promise(res => {
    const m = modal({
      title, body: `<p style="margin:0">${text}</p>`,
      actions: [{ label: "Annuler", onClick: () => res(false) }, { label, cls: danger ? "danger" : "primary", onClick: () => res(true) }],
    });
    $("[data-x]", m.el).addEventListener("click", () => res(false));
  });
}

/* ---------- Fichiers ---------- */
export const readAsDataURL = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
export const readAsText = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsText(f); });

/** Réduit une image trop grande avant envoi (garde la qualité pour un BAT). */
export async function shrinkImage(dataUrl, max = 2400) {
  if (!/^data:image\/(png|jpe?g|webp)/.test(dataUrl)) return dataUrl;
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = dataUrl; });
  if (img.width <= max && img.height <= max) return dataUrl;
  const k = max / Math.max(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg", .9);
}

export async function uploadFile(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} : fichier trop lourd (max 30 Mo)`);
  let dataUrl = await readAsDataURL(file);
  dataUrl = await shrinkImage(dataUrl);
  return api("POST", "/upload", { dataUrl, name: file.name });
}

export function pickFiles({ accept = "image/*,application/pdf", multiple = true, capture = "" } = {}) {
  return new Promise(res => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = multiple;
    if (capture) i.setAttribute("capture", capture); // ouvre directement l'appareil photo sur mobile
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

/** Zone de dépôt : appelle onFiles(File[]) au drop ou au clic. */
export function bindDrop(el, onFiles, accept) {
  el.addEventListener("click", async () => { const f = await pickFiles({ accept }); if (f.length) onFiles(f); });
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("over"); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
}

export function lightbox(src) {
  const d = document.createElement("div");
  d.className = "lightbox";
  d.innerHTML = `<img src="${h(src)}" alt="">`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

export function download(name, content, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- CSV ---------- */
export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0] || "";
  const delim = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
export const toCSV = rows => "﻿" + rows.map(r => r.map(c => {
  const s = String(c ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(";")).join("\n");
export const parseNum = s => { const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace("€", "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
