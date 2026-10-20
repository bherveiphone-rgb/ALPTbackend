/* Back-office — routeur, connexion, navigation, tableau de bord, liste des devis. */
import { S, api, isEmp, h, $, $$, icon, badge, fail, fmtEUR, fmtDate, ago, download, toCSV } from "./ui.js";
import { QUOTE_STATUSES, BAT_STATUSES } from "./pricing.js";
import { renderEditor, editorGuard } from "./editor.js";
import { renderCatalog, renderTechniques, renderSimulator } from "./catalog.js";
import { renderContacts, renderContact, renderRequests, renderRequest, renderTasks, renderPipeline, taskRow, bindTaskRows } from "./contacts.js";
import { renderProduction, renderBilling, renderSheet } from "./operations.js";
import { renderProspection } from "./prospection.js";
import { renderSettings } from "./settings.js";
import { renderPurchasing, templatePicker } from "./achats.js";
import { renderShops } from "./boutiques.js";
import { renderPlanning, renderStock } from "./atelier.js";
import { renderStats } from "./stats.js";

const root = $("#root");

/* ---------------- Connexion ---------------- */
function renderLogin() {
  root.innerHTML = `<div class="login"><form class="card" id="loginForm">
    <div class="brand"><div class="logo">${icon("file")}</div><div>Devis &amp; BAT<small style="color:var(--muted)">Espace atelier</small></div></div>
    <label class="f"><span>Email</span><input type="email" id="em" autocomplete="username" placeholder="Laisser vide pour le compte principal"></label>
    <label class="f" style="margin-top:10px"><span>Mot de passe</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary lg" style="width:100%;margin-top:16px">${icon("lock")} Se connecter</button>
    <p class="hint" style="text-align:center;margin-top:14px">Compte principal : email vide + mot de passe ADMIN_PASSWORD.<br>Collaborateurs : email et mot de passe créés dans Paramètres › Utilisateurs.</p>
  </form></div>`;
  $("#em").focus();
  $("#loginForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("#em").value.trim(), pw = $("#pw").value;
    try {
      if (email) {
        const r = await fetch("/api/devis/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Connexion impossible");
        S.tok = d.token; S.pw = "";
        localStorage.setItem("devis_tok", d.token);
      } else S.pw = pw;
      await boot();
      if (!email) sessionStorage.setItem("devis_pw", S.pw);
    } catch (err) { S.tok = ""; localStorage.removeItem("devis_tok"); fail(err); }
  };
}

export async function reloadBootstrap() { Object.assign(S, await api("GET", "/bootstrap")); }
async function boot() {
  await reloadBootstrap();
  S.quotes = await api("GET", "/quotes");
  renderShell();
  route();
  refreshCounts();
  setInterval(refreshCounts, 120_000);
}
export async function reloadQuotes() { S.quotes = await api("GET", "/quotes"); updateNavCounts(); }
/** Recharge les compteurs du menu (demandes nouvelles, tâches du jour, devis avec activité client). */
export async function refreshCounts() {
  try {
    const [requests, tasks] = await Promise.all([api("GET", "/requests"), api("GET", "/tasks")]);
    S.requests = requests; S.tasks = tasks;
    updateNavCounts();
  } catch { /* hors ligne */ }
}

/* ---------------- Application installable (PWA) ---------------- */
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#installApp")?.classList.remove("hidden"); });

/* ---------------- Coquille ---------------- */
const NAV = [
  ["#/", "dash", "Tableau de bord"],
  ["#/taches", "check", "Tâches", "tasks"],
  "Ventes",
  ["#/demandes", "msg", "Demandes", "requests"],
  ["#/pipeline", "layers", "Pipeline"],
  ["#/devis", "file", "Devis", "quotes"],
  ["#/contacts", "users", "Contacts"],
  ["#/boutiques", "card", "Boutiques club"],
  ["#/prospection", "trend", "Prospection"],
  "Atelier",
  ["#/production", "brush", "Production"],
  ["#/planning", "calendar", "Planning"],
  ["#/achats", "shirt", "Achats"],
  ["#/stock", "box", "Stock"],
  ["#/facturation", "euro", "Facturation", null, true],
  ["#/stats", "chart", "Statistiques", null, true],
  ["#/simulateur", "calc", "Simulateur de prix", null, true],
  "Réglages",
  ["#/references", "shirt", "Références", null, true],
  ["#/techniques", "sparkle", "Marquages & tarifs", null, true],
  ["#/parametres", "gear", "Paramètres", null, true],
];
const ADMIN_PAGES = ["facturation", "simulateur", "references", "techniques", "parametres", "stats"];
function renderShell() {
  root.innerHTML = `<div class="mobile-top no-print"><button class="btn ghost icon" id="burger">${icon("menu")}</button><b>${h(S.settings.company.name || "Devis & BAT")}</b></div>
  <div class="app">
    <aside class="side no-print" id="side">
      <div class="brand"><div class="logo">${S.settings.company.logo ? `<img src="${h(S.settings.company.logo)}" style="width:100%;height:100%;object-fit:contain;border-radius:10px;background:#fff">` : icon("file")}</div><div>${h(S.settings.company.name || "Devis & BAT")}<small>Devis · CRM · Production</small></div></div>
      <nav class="nav">${NAV.filter(n => typeof n === "string" ? !(isEmp() && n === "Réglages") : !(isEmp() && n[4])).map(n => typeof n === "string" ? `<div class="grp">${n}</div>` :
        `<a href="${n[0]}" data-nav="${n[0]}">${icon(n[1])}<span>${n[2]}</span>${n[3] ? `<span class="count hidden" data-count="${n[3]}"></span>` : ""}</a>`).join("")}</nav>
      <div class="foot"><button class="link-btn" id="newQuoteSide" style="color:#fff">${icon("plus", "sm")} Nouveau devis</button>
        <div style="margin-top:12px;color:var(--side-text);font-size:12.5px">${icon("users", "sm")} ${h(S.user?.name || "")}${isEmp() ? " · employé" : ""}</div>
        <button class="link-btn hidden" id="installApp" style="color:#fff;margin-top:10px">${icon("download", "sm")} Installer l'application</button>
        <div style="margin-top:6px"><button class="link-btn" id="logout" style="color:var(--side-text);font-weight:500">Se déconnecter</button></div></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  $("#burger").onclick = () => $("#side").classList.toggle("open");
  $("#logout").onclick = async () => {
    if (S.tok) await api("POST", "/auth/logout").catch(() => {});
    sessionStorage.removeItem("devis_pw"); localStorage.removeItem("devis_tok"); location.hash = ""; location.reload();
  };
  $("#newQuoteSide").onclick = () => newQuote();
  if (installEvt) $("#installApp").classList.remove("hidden");
  $("#installApp").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installApp").classList.add("hidden"); };
  updateNavCounts();
}
export function updateNavCounts() {
  const endOfDay = new Date().setHours(23, 59, 59, 999);
  const counts = {
    quotes: (S.quotes || []).filter(q => q.attention).length,
    requests: (S.requests || []).filter(r => r.status === "nouvelle").length,
    tasks: (S.tasks || []).filter(t => !t.done && t.due <= endOfDay).length,
  };
  for (const [k, n] of Object.entries(counts)) {
    const el = $(`[data-count="${k}"]`);
    if (el) { el.textContent = n; el.classList.toggle("hidden", !n); el.classList.toggle("blue", k === "tasks"); }
  }
}

/* ---------------- Routeur ---------------- */
let lastHash = location.hash;
window.addEventListener("hashchange", async () => {
  if (!(await editorGuard())) { history.replaceState(null, "", lastHash); return; }
  route();
});
export function route() {
  lastHash = location.hash;
  const hash = location.hash || "#/";
  $("#side")?.classList.remove("open");
  $$(".modal-bg, .lightbox").forEach(m => m.remove());
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === "#/" ? hash === "#/" : hash.startsWith(a.dataset.nav)));
  const main = $("#main");
  window.scrollTo(0, 0);
  let [, page, id] = hash.split("/");
  if (isEmp() && ADMIN_PAGES.includes(page)) page = "";
  const views = {
    "": renderDashboard, devis: id ? () => renderEditor(main, id) : renderQuotes,
    contacts: id ? () => renderContact(main, id) : renderContacts, clients: renderContacts,
    demandes: id ? () => renderRequest(main, id) : renderRequests, taches: renderTasks, pipeline: renderPipeline,
    production: renderProduction, planning: renderPlanning, stats: renderStats, stock: renderStock, achats: renderPurchasing, boutiques: renderShops, facturation: renderBilling, fiche: () => renderSheet(main, id), prospection: renderProspection,
    references: renderCatalog, techniques: renderTechniques, simulateur: renderSimulator, parametres: renderSettings,
  };
  (views[page] || renderDashboard)(main);
}

export async function newQuote(preset = {}) {
  try {
    const q = await api("POST", "/quotes", preset);
    await reloadQuotes();
    location.hash = `#/devis/${q.id}`;
  } catch (e) { fail(e); }
}

const statusBadge = s => { const x = QUOTE_STATUSES[s] || QUOTE_STATUSES.brouillon; return badge(x.label, x.tone); };
const batBadge = s => { const x = BAT_STATUSES[s] || BAT_STATUSES.aucun; return s === "aucun" ? `<span class="faint">—</span>` : badge(x.label, x.tone); };
export { statusBadge, batBadge };
export const SIGNED = ["accepte", "production", "expedie", "livre"];

/* ---------------- Tableau de bord ---------------- */
async function renderDashboard(main) {
  await Promise.all([reloadQuotes(), refreshCounts()]).catch(fail);
  const Q = S.quotes, R = S.requests || [], T = S.tasks || [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const signed = q => SIGNED.includes(q.status);
  const sent = Q.filter(q => q.sentAt || signed(q) || q.status === "refuse");
  const pending = Q.filter(q => q.status === "envoye");
  const signedMonth = Q.filter(q => signed(q) && (q.acceptedAt || q.updatedAt) >= monthStart);
  const conv = sent.length ? Math.round(Q.filter(signed).length / sent.length * 100) : 0;
  const newReq = R.filter(r => r.status === "nouvelle");
  const endOfDay = new Date().setHours(23, 59, 59, 999);
  const todayTasks = T.filter(t => !t.done && t.due <= endOfDay);
  const inProd = Q.filter(q => q.production && !["livre"].includes(q.production.stage) && q.status !== "livre");
  const late = inProd.filter(q => q.deadline && q.deadline < Date.now());

  const todos = [];
  for (const q of Q) {
    const who = h(q.client.company || q.client.contact || "Client");
    if (q.batStatus === "modif") todos.push({ q, tone: "danger", ic: "alert", t: `Modification demandée sur le BAT — ${who}` });
    else if (q.batStatus === "valide" && q.status === "accepte" && (!q.production || q.production.stage === "a_lancer")) todos.push({ q, tone: "success", ic: "check", t: `BAT validé : lancer la production — ${who}` });
    else if (q.status === "accepte" && q.batStatus === "aucun") todos.push({ q, tone: "info", ic: "image", t: `Devis accepté : préparer et envoyer le BAT — ${who}` });
    else if (q.attention) todos.push({ q, tone: "warning", ic: "msg", t: `Nouvelle activité client — ${who}` });
  }

  const months = [...Array(6)].map((_, i) => ({ d: new Date(now.getFullYear(), now.getMonth() - 5 + i, 1), v: 0 }));
  for (const q of Q.filter(signed)) {
    const t = new Date(q.acceptedAt || q.updatedAt);
    const m = months.find(x => x.d.getFullYear() === t.getFullYear() && x.d.getMonth() === t.getMonth());
    if (m) m.v += q.totals.ht || 0;
  }
  const maxM = Math.max(1, ...months.map(m => m.v));
  const stages = S.settings.productionStages.filter(s => s.key !== "livre");

  const kpi = (lbl, ic, color, val, sub, href) => `<a class="card kpi" href="${href}" style="text-decoration:none;color:inherit"><div class="lbl"><span class="dot" style="background:${color}1a;color:${color}">${icon(ic, "sm")}</span>${lbl}</div><div class="val num">${val}</div><div class="sub">${sub}</div></a>`;
  main.innerHTML = `
  <div class="page-head"><div class="grow"><h1>Bonjour 👋</h1><p>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} — voici l'activité de votre atelier.</p></div>
    <a class="btn" href="#/simulateur">${icon("calc")} Simuler un prix</a>
    <button class="btn primary" id="nq">${icon("plus")} Nouveau devis</button></div>
  ${/^(localhost|127\.)/.test(location.hostname) && !S.settings.publicUrl ? `<div class="banner t-danger">${icon("link")}<div class="grow"><b>Outil installé sur cet ordinateur :</b> renseignez l'adresse publique (tunnel) pour que vos clients puissent ouvrir leurs devis, BAT et le formulaire.</div><a class="btn sm" href="#/parametres/formulaire">Régler</a></div>` : ""}
  ${!S.mailEnabled ? `<div class="banner t-warning">${icon("alert")}<div class="grow"><b>Connectez votre boîte mail</b> pour envoyer devis, BAT, relances et campagnes de prospection directement depuis l'outil, et rattacher automatiquement les réponses de vos clients.</div><a class="btn sm" href="#/parametres/emails">Connecter</a></div>` : ""}
  <div class="grid g4 kpis">
    ${kpi("Nouvelles demandes", "msg", "#f97316", newReq.length, newReq.length ? `la plus ancienne ${ago(Math.min(...newReq.map(r => r.createdAt)))}` : "aucune en attente", "#/demandes")}
    ${kpi("En attente de réponse", "send", "#0284c7", fmtEUR(pending.reduce((s, q) => s + (q.totals.ht || 0), 0)), `${pending.length} devis envoyé${pending.length > 1 ? "s" : ""} · HT`, "#/devis")}
    ${kpi("Signé ce mois-ci", "trend", "#16a34a", fmtEUR(signedMonth.reduce((s, q) => s + (q.totals.ht || 0), 0)), `${signedMonth.length} devis · transfo ${conv} %`, "#/pipeline")}
    ${kpi("En production", "brush", "#7c3aed", inProd.length, late.length ? `<b style="color:var(--danger)">${late.length} en retard</b>` : "aucun retard", "#/production")}
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card"><div class="card-h"><h2>Mes tâches du jour</h2>${todayTasks.length ? badge(todayTasks.length, "info", true) : ""}<a class="btn sm ghost" href="#/taches">Tout voir</a></div>
      <div id="dashTasks">${todayTasks.length ? todayTasks.slice(0, 8).map(taskRow).join("") : `<div class="empty" style="padding:28px"><div class="ico">${icon("check")}</div>Rien d'urgent aujourd'hui.</div>`}</div></div>
    <div class="card"><div class="card-h"><h2>À traiter sur les devis</h2>${todos.length ? badge(todos.length, "warning", true) : ""}</div>
      ${newReq.slice(0, 3).map(r => `<div class="todo" data-req="${r.id}"><div class="ic t-warning">${icon("msg", "sm")}</div><div style="flex:1;min-width:0"><div>Nouvelle demande — ${h(r.contact.company || r.contact.contact)}</div><small>${h(r.number)} · ${r.items.reduce((s, i) => s + i.quantity, 0)} pièces · ${ago(r.createdAt)}</small></div></div>`).join("")}
      ${todos.length || newReq.length ? todos.slice(0, 8).map(t => `<div class="todo" data-go="${t.q.id}"><div class="ic t-${t.tone}">${icon(t.ic, "sm")}</div><div style="flex:1;min-width:0"><div>${t.t}</div><small>${h(t.q.number)} · ${fmtEUR(t.q.totals.ht)} HT · ${ago(t.q.updatedAt)}</small></div></div>`).join("")
        : `<div class="empty" style="padding:28px"><div class="ico">${icon("check")}</div>Tout est à jour.</div>`}
    </div>
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card"><div class="card-h"><h2>Atelier</h2><a class="btn sm ghost" href="#/production">Tableau de production</a></div><div class="card-b">
      <div class="grid g3" style="gap:10px">${stages.map(s => { const n = inProd.filter(q => (q.production?.stage || "a_lancer") === s.key).length; return `<a href="#/production" class="margin-box" style="margin:0;text-decoration:none;color:inherit;border-style:solid"><small class="muted">${h(s.label)}</small><b style="display:block;font-size:20px">${n}</b></a>`; }).join("")}</div>
      ${late.length ? `<div class="warn-list">${late.map(q => `<div>⚠ ${h(q.number)} — ${h(q.client.company || q.client.contact)} attendu le ${fmtDate(q.deadline)}</div>`).join("")}</div>` : ""}
    </div></div>
    <div class="card"><div class="card-h"><h2>CA signé (HT) — 6 mois</h2></div><div class="card-b">
      <div class="bars">${months.map(m => `<div class="b"><em>${m.v ? Math.round(m.v).toLocaleString("fr-FR") + " €" : ""}</em><i style="height:${Math.max(2, m.v / maxM * 100)}%"></i><span>${m.d.toLocaleDateString("fr-FR", { month: "short" })}</span></div>`).join("")}</div>
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Derniers devis</h2><a href="#/devis" class="btn sm ghost">Tout voir</a></div>${quotesTable(Q.slice(0, 6))}</div>`;
  $$("[data-go]", main).forEach(el => el.onclick = () => location.hash = `#/devis/${el.dataset.go}`);
  $$("[data-req]", main).forEach(el => el.onclick = () => location.hash = `#/demandes/${el.dataset.req}`);
  $("#nq").onclick = () => newQuote();
  bindTaskRows($("#dashTasks"), () => renderDashboard(main));
  bindQuoteRows(main);
}

export function quotesTable(list, { compact = false } = {}) {
  if (!list.length) return `<div class="empty"><div class="ico">${icon("file")}</div><b>Aucun devis</b><p>Créez un devis en quelques clics.</p></div>`;
  return `<div class="table-wrap"><table class="t"><thead><tr><th>N°</th>${compact ? "" : "<th>Client</th>"}<th>Objet</th><th>Statut</th><th>BAT</th><th class="r">Total HT</th><th>Mis à jour</th></tr></thead><tbody>
  ${list.map(q => `<tr class="click" data-q="${q.id}">
    <td><b class="num">${h(q.number)}</b> ${q.attention ? `<span class="attention-dot" title="Nouvelle activité client"></span>` : ""}</td>
    ${compact ? "" : `<td><div>${h(q.client.company || q.client.contact || "—")}</div>${q.client.company && q.client.contact ? `<small>${h(q.client.contact)}</small>` : ""}</td>`}
    <td>${h(q.title || "—")}</td>
    <td>${statusBadge(q.status)}${q.viewedAt && q.status === "envoye" ? ` <span title="Consulté ${fmtDate(q.viewedAt, true)}">${icon("eye", "sm")}</span>` : ""}${q.payment?.status === "paye" ? ` <span title="Payé">${icon("card", "sm")}</span>` : ""}</td>
    <td>${batBadge(q.batStatus)}</td>
    <td class="r num"><b>${fmtEUR(q.totals.ht)}</b></td>
    <td><small>${ago(q.updatedAt)}</small></td></tr>`).join("")}
  </tbody></table></div>`;
}
export const bindQuoteRows = el => $$("[data-q]", el).forEach(r => r.onclick = () => location.hash = `#/devis/${r.dataset.q}`);

/* ---------------- Liste des devis ---------------- */
let quoteFilter = { q: "", status: "all" };
async function renderQuotes(main) {
  await reloadQuotes().catch(fail);
  const tabs = [["all", "Tous"], ["action", "À traiter"], ["brouillon", "Brouillons"], ["envoye", "Envoyés"], ["accepte", "Acceptés"], ["production", "Production"], ["expedie", "Expédiés"], ["livre", "Livrés"], ["refuse", "Refusés"]];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Devis</h1><p>${S.quotes.length} devis au total</p></div>
    <button class="btn" id="exp">${icon("download")} Export CSV</button>
    <button class="btn" id="fromTpl">${icon("copy")} Depuis un modèle</button>
    <button class="btn primary" id="nq">${icon("plus")} Nouveau devis</button></div>
    <div class="card"><div class="toolbar">
      <div class="search">${icon("search", "sm")}<input type="search" id="qs" placeholder="Rechercher n°, client, objet…" value="${h(quoteFilter.q)}"></div>
      <div class="seg" id="seg">${tabs.map(([k, l]) => `<button data-s="${k}" class="${quoteFilter.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
    </div><div id="qt"></div></div>`;
  const draw = () => {
    const s = quoteFilter.q.toLowerCase();
    const list = S.quotes.filter(q => {
      if (quoteFilter.status === "action" && !(q.attention || q.batStatus === "modif" || (q.status === "accepte" && q.batStatus !== "en_attente"))) return false;
      if (!["all", "action"].includes(quoteFilter.status) && q.status !== quoteFilter.status) return false;
      return !s || [q.number, q.title, q.client.company, q.client.contact, q.client.email].join(" ").toLowerCase().includes(s);
    });
    $("#qt").innerHTML = quotesTable(list);
    bindQuoteRows($("#qt"));
  };
  $("#qs").oninput = e => { quoteFilter.q = e.target.value; draw(); };
  $("#fromTpl").onclick = () => templatePicker(preset => newQuote(preset));
  $$("#seg button").forEach(b => b.onclick = () => { quoteFilter.status = b.dataset.s; $$("#seg button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  $("#nq").onclick = () => newQuote();
  $("#exp").onclick = () => download(`devis-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([
    ["Numéro", "Date", "Client", "Contact", "Email", "Objet", "Statut", "BAT", "Quantité", "Total HT", "TVA", "Total TTC", "Marge HT", "Marge %", "Paiement"],
    ...S.quotes.map(q => [q.number, fmtDate(q.createdAt), q.client.company, q.client.contact, q.client.email, q.title,
      QUOTE_STATUSES[q.status]?.label, BAT_STATUSES[q.batStatus]?.label, q.totals.qty, q.totals.ht, q.totals.vat, q.totals.ttc, q.totals.margin, q.totals.marginPct, q.payment?.status || ""]),
  ]), "text/csv");
  draw();
}

/* ---------------- Contacts : champs partagés avec l'éditeur ---------------- */
export const clientSnapshot = c => ({ company: c.company || "", contact: c.contact || "", email: c.email || "", phone: c.phone || "", address: c.address || "", zip: c.zip || "", city: c.city || "", vatNumber: c.vatNumber || "" });
export const CLIENT_FIELDS = [["company", "Société / Club / Association"], ["contact", "Nom du contact"], ["email", "Email", "email"], ["phone", "Téléphone", "tel"],
  ["address", "Adresse"], ["zip", "Code postal"], ["city", "Ville"], ["vatNumber", "N° TVA intracom. / SIRET"]];
export { clientModal } from "./contacts.js";

/* ---------------- Démarrage ---------------- */
if (S.pw || S.tok) boot().catch(() => renderLogin()); else renderLogin();
