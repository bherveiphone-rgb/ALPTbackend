/* Back-office Devis & BAT — routeur, connexion, tableau de bord, devis, clients, paramètres. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, ago, uid, num, download, uploadFile, pickFiles, readAsText, toCSV } from "./ui.js";
import { QUOTE_STATUSES, BAT_STATUSES } from "./pricing.js";
import { renderEditor, editorGuard } from "./editor.js";
import { renderCatalog, renderTechniques, renderSimulator } from "./catalog.js";

const root = $("#root");

/* ---------------- Connexion ---------------- */
function renderLogin() {
  root.innerHTML = `<div class="login"><form class="card" id="loginForm">
    <div class="brand"><div class="logo">${icon("file")}</div><div>Devis &amp; BAT<small style="color:var(--muted)">Espace atelier</small></div></div>
    <label class="f"><span>Mot de passe administrateur</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary lg" style="width:100%;margin-top:16px">${icon("lock")} Se connecter</button>
    <p class="hint" style="text-align:center;margin-top:14px">Même mot de passe que le back-office boutique (ADMIN_PASSWORD).</p>
  </form></div>`;
  $("#pw").focus();
  $("#loginForm").onsubmit = async e => {
    e.preventDefault();
    S.pw = $("#pw").value;
    try {
      await boot();
      sessionStorage.setItem("devis_pw", S.pw);
    } catch (err) { fail(err); }
  };
}

async function boot() {
  const b = await api("GET", "/bootstrap");
  Object.assign(S, b);
  S.quotes = await api("GET", "/quotes");
  renderShell();
  route();
}
export async function reloadQuotes() { S.quotes = await api("GET", "/quotes"); updateNavCounts(); }

/* ---------------- Coquille ---------------- */
const NAV = [
  ["#/", "dash", "Tableau de bord"],
  ["#/devis", "file", "Devis", "quotes"],
  ["#/simulateur", "calc", "Simulateur de prix"],
  ["#/clients", "users", "Clients"],
  "sep",
  ["#/references", "shirt", "Références"],
  ["#/techniques", "brush", "Marquages & tarifs"],
  ["#/parametres", "gear", "Paramètres"],
];
function renderShell() {
  root.innerHTML = `<div class="mobile-top no-print"><button class="btn ghost icon" id="burger">${icon("menu")}</button><b>Devis &amp; BAT</b></div>
  <div class="app">
    <aside class="side no-print" id="side">
      <div class="brand"><div class="logo">${icon("file")}</div><div>${h(S.settings.company.name || "Devis & BAT")}<small>Devis · BAT · Production</small></div></div>
      <nav class="nav">${NAV.map(n => n === "sep" ? `<div class="sep"></div>` :
        `<a href="${n[0]}" data-nav="${n[0]}">${icon(n[1])}<span>${n[2]}</span>${n[3] ? `<span class="count hidden" data-count="${n[3]}"></span>` : ""}</a>`).join("")}</nav>
      <div class="foot"><button class="link-btn" id="newQuoteSide" style="color:#fff">${icon("plus", "sm")} Nouveau devis</button>
        <div style="margin-top:12px"><button class="link-btn" id="logout" style="color:var(--side-text);font-weight:500">Se déconnecter</button></div></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  $("#burger").onclick = () => $("#side").classList.toggle("open");
  $("#logout").onclick = () => { sessionStorage.removeItem("devis_pw"); location.hash = ""; location.reload(); };
  $("#newQuoteSide").onclick = () => newQuote();
  updateNavCounts();
}
function updateNavCounts() {
  const n = S.quotes.filter(q => q.attention).length;
  const el = $('[data-count="quotes"]');
  if (el) { el.textContent = n; el.classList.toggle("hidden", !n); }
}

/* ---------------- Routeur ---------------- */
let lastHash = location.hash;
window.addEventListener("hashchange", async () => {
  if (!(await editorGuard())) { history.replaceState(null, "", lastHash); return; }
  route();
});
function route() {
  lastHash = location.hash;
  const hash = location.hash || "#/";
  $("#side")?.classList.remove("open");
  $$(".modal-bg, .lightbox").forEach(m => m.remove());
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === "#/" ? hash === "#/" : hash.startsWith(a.dataset.nav)));
  const main = $("#main");
  main.scrollTop = 0; window.scrollTo(0, 0);
  const [, page, id] = hash.split("/");
  const views = {
    "": renderDashboard, devis: id ? () => renderEditor(main, id) : renderQuotes, clients: renderClients,
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

/* ---------------- Tableau de bord ---------------- */
async function renderDashboard(main) {
  await reloadQuotes().catch(fail);
  const Q = S.quotes;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const signed = q => ["accepte", "production", "livre"].includes(q.status);
  const sent = Q.filter(q => q.sentAt || signed(q) || q.status === "refuse");
  const pending = Q.filter(q => q.status === "envoye");
  const signedMonth = Q.filter(q => signed(q) && (q.acceptedAt || q.updatedAt) >= monthStart);
  const conv = sent.length ? Math.round(Q.filter(signed).length / sent.length * 100) : 0;
  const batWaiting = Q.filter(q => q.batStatus === "en_attente");

  // À traiter
  const todos = [];
  for (const q of Q) {
    const who = h(q.client.company || q.client.contact || "Client");
    if (q.batStatus === "modif") todos.push({ q, tone: "danger", ic: "alert", t: `Modification demandée sur le BAT — ${who}` });
    else if (q.batStatus === "valide" && q.status === "accepte") todos.push({ q, tone: "success", ic: "check", t: `BAT validé : lancer la production — ${who}` });
    else if (q.status === "accepte" && q.batStatus === "aucun") todos.push({ q, tone: "info", ic: "image", t: `Devis accepté : préparer et envoyer le BAT — ${who}` });
    else if (q.attention) todos.push({ q, tone: "warning", ic: "msg", t: `Nouvelle activité client — ${who}` });
    if (q.status === "envoye" && q.sentAt && Date.now() - q.sentAt > 7 * 864e5) todos.push({ q, tone: "neutral", ic: "clock", t: `Sans réponse depuis ${Math.floor((Date.now() - q.sentAt) / 864e5)} j : relancer — ${who}` });
    if (q.status === "brouillon" && q.lineCount && Date.now() - q.updatedAt > 3 * 864e5) todos.push({ q, tone: "neutral", ic: "file", t: `Brouillon non envoyé — ${who}` });
  }

  // CA signé par mois (6 derniers mois)
  const months = [...Array(6)].map((_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); return { d, v: 0 }; });
  for (const q of Q.filter(signed)) {
    const t = new Date(q.acceptedAt || q.updatedAt);
    const m = months.find(x => x.d.getFullYear() === t.getFullYear() && x.d.getMonth() === t.getMonth());
    if (m) m.v += q.totals.ht || 0;
  }
  const maxM = Math.max(1, ...months.map(m => m.v));

  const kpi = (lbl, ic, color, val, sub) => `<div class="card kpi"><div class="lbl"><span class="dot" style="background:${color}1a;color:${color}">${icon(ic, "sm")}</span>${lbl}</div><div class="val num">${val}</div><div class="sub">${sub}</div></div>`;
  main.innerHTML = `
  <div class="page-head"><div class="grow"><h1>Bonjour 👋</h1><p>Voici l'activité de votre atelier.</p></div>
    <a class="btn" href="#/simulateur">${icon("calc")} Simuler un prix</a>
    <button class="btn primary" id="nq">${icon("plus")} Nouveau devis</button></div>
  <div class="grid g4 kpis">
    ${kpi("En attente de réponse", "send", "#0284c7", fmtEUR(pending.reduce((s, q) => s + (q.totals.ht || 0), 0)), `${pending.length} devis envoyé${pending.length > 1 ? "s" : ""} · HT`)}
    ${kpi("Signé ce mois-ci", "trend", "#16a34a", fmtEUR(signedMonth.reduce((s, q) => s + (q.totals.ht || 0), 0)), `${signedMonth.length} devis · HT`)}
    ${kpi("Taux de transformation", "sparkle", "#7c3aed", conv + " %", `${Q.filter(signed).length} signés / ${sent.length} envoyés`)}
    ${kpi("BAT en attente", "image", "#d97706", batWaiting.length, "en attente de validation client")}
  </div>
  <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
    <div class="card"><div class="card-h"><h2>À traiter</h2>${todos.length ? badge(todos.length, "warning", true) : ""}</div>
      ${todos.length ? todos.slice(0, 9).map(t => `<div class="todo" data-go="${t.q.id}"><div class="ic t-${t.tone}">${icon(t.ic, "sm")}</div><div style="flex:1;min-width:0"><div>${t.t}</div><small>${h(t.q.number)} · ${fmtEUR(t.q.totals.ht)} HT · ${ago(t.q.updatedAt)}</small></div><span style="transform:rotate(180deg);display:inline-flex">${icon("back", "sm")}</span></div>`).join("")
        : `<div class="empty"><div class="ico">${icon("check")}</div>Tout est à jour, rien à traiter.</div>`}
    </div>
    <div class="card"><div class="card-h"><h2>CA signé (HT) — 6 mois</h2></div><div class="card-b">
      <div class="bars">${months.map(m => `<div class="b"><em>${m.v ? Math.round(m.v).toLocaleString("fr-FR") + " €" : ""}</em><i style="height:${Math.max(2, m.v / maxM * 100)}%"></i><span>${m.d.toLocaleDateString("fr-FR", { month: "short" })}</span></div>`).join("")}</div>
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Derniers devis</h2><a href="#/devis" class="btn sm ghost">Tout voir</a></div>
    ${quotesTable(Q.slice(0, 6))}</div>`;
  $$("[data-go]", main).forEach(el => el.onclick = () => location.hash = `#/devis/${el.dataset.go}`);
  $("#nq").onclick = () => newQuote();
  bindQuoteRows(main);
}

function quotesTable(list) {
  if (!list.length) return `<div class="empty"><div class="ico">${icon("file")}</div><b>Aucun devis pour l'instant</b><p>Créez votre premier devis en quelques clics.</p></div>`;
  return `<div class="table-wrap"><table class="t"><thead><tr><th>N°</th><th>Client</th><th>Objet</th><th>Statut</th><th>BAT</th><th class="r">Total HT</th><th>Mis à jour</th></tr></thead><tbody>
  ${list.map(q => `<tr class="click" data-q="${q.id}">
    <td><b class="num">${h(q.number)}</b> ${q.attention ? `<span class="attention-dot" title="Nouvelle activité client"></span>` : ""}</td>
    <td><div>${h(q.client.company || q.client.contact || "—")}</div>${q.client.company && q.client.contact ? `<small>${h(q.client.contact)}</small>` : ""}</td>
    <td>${h(q.title || "—")}</td>
    <td>${statusBadge(q.status)}${q.viewedAt && q.status === "envoye" ? ` <span title="Consulté ${fmtDate(q.viewedAt, true)}">${icon("eye", "sm")}</span>` : ""}${q.depositPaid ? ` <span title="Acompte payé">${icon("card", "sm")}</span>` : ""}</td>
    <td>${batBadge(q.batStatus)}</td>
    <td class="r num"><b>${fmtEUR(q.totals.ht)}</b></td>
    <td><small>${ago(q.updatedAt)}</small></td></tr>`).join("")}
  </tbody></table></div>`;
}
const bindQuoteRows = root => $$("[data-q]", root).forEach(r => r.onclick = () => location.hash = `#/devis/${r.dataset.q}`);

/* ---------------- Liste des devis ---------------- */
let quoteFilter = { q: "", status: "all" };
async function renderQuotes(main) {
  await reloadQuotes().catch(fail);
  const tabs = [["all", "Tous"], ["action", "À traiter"], ["brouillon", "Brouillons"], ["envoye", "Envoyés"], ["accepte", "Acceptés"], ["production", "Production"], ["livre", "Livrés"], ["refuse", "Refusés"]];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Devis</h1><p>${S.quotes.length} devis au total</p></div>
    <button class="btn" id="exp">${icon("download")} Export CSV</button>
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
  $$("#seg button").forEach(b => b.onclick = () => { quoteFilter.status = b.dataset.s; $$("#seg button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  $("#nq").onclick = () => newQuote();
  $("#exp").onclick = () => {
    download(`devis-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([
      ["Numéro", "Date", "Client", "Contact", "Email", "Objet", "Statut", "BAT", "Quantité", "Total HT", "TVA", "Total TTC", "Marge HT", "Marge %"],
      ...S.quotes.map(q => [q.number, fmtDate(q.createdAt), q.client.company, q.client.contact, q.client.email, q.title,
        QUOTE_STATUSES[q.status]?.label, BAT_STATUSES[q.batStatus]?.label, q.totals.qty, q.totals.ht, q.totals.vat, q.totals.ttc, q.totals.margin, q.totals.marginPct]),
    ]), "text/csv");
  };
  draw();
}

/* ---------------- Clients ---------------- */
async function renderClients(main) {
  await reloadQuotes().catch(fail);
  const stats = id => {
    const qs = S.quotes.filter(q => q.clientId === id);
    return { n: qs.length, ca: qs.filter(q => ["accepte", "production", "livre"].includes(q.status)).reduce((s, q) => s + (q.totals.ht || 0), 0) };
  };
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Clients</h1><p>Vos clients sont réutilisables dans les devis, avec leur remise habituelle.</p></div>
    <button class="btn primary" id="add">${icon("plus")} Nouveau client</button></div>
    <div class="card"><div class="toolbar"><div class="search">${icon("search", "sm")}<input type="search" id="cs" placeholder="Rechercher un client…"></div></div><div id="ct"></div></div>`;
  const draw = () => {
    const s = $("#cs").value.toLowerCase();
    const list = S.clients.filter(c => !s || [c.company, c.contact, c.email, c.city].join(" ").toLowerCase().includes(s));
    $("#ct").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Société / Club</th><th>Contact</th><th>Email / Tél.</th><th class="r">Remise</th><th class="r">Devis</th><th class="r">CA signé HT</th><th></th></tr></thead><tbody>
      ${list.map(c => { const st = stats(c.id); return `<tr class="click" data-c="${c.id}"><td><b>${h(c.company || "—")}</b><br><small>${h([c.zip, c.city].filter(Boolean).join(" "))}</small></td><td>${h(c.contact)}</td><td>${h(c.email)}<br><small>${h(c.phone)}</small></td>
        <td class="r">${c.discountPct ? badge(c.discountPct + " %", "violet", true) : "—"}</td><td class="r">${st.n}</td><td class="r num"><b>${fmtEUR(st.ca)}</b></td>
        <td class="r"><button class="btn sm" data-nq="${c.id}">${icon("plus", "sm")} Devis</button></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="ico">${icon("users")}</div><b>Aucun client</b><p>Ajoutez vos clients ou enregistrez-les directement depuis un devis.</p></div>`;
    $$("[data-c]").forEach(r => r.onclick = e => { if (!e.target.closest("[data-nq]")) clientModal(S.clients.find(c => c.id === r.dataset.c), () => renderClients(main)); });
    $$("[data-nq]").forEach(b => b.onclick = () => {
      const c = S.clients.find(x => x.id === b.dataset.nq);
      newQuote({ clientId: c.id, client: clientSnapshot(c), discountPct: c.discountPct || 0 });
    });
  };
  $("#cs").oninput = draw;
  $("#add").onclick = () => clientModal(null, () => renderClients(main));
  draw();
}
export const clientSnapshot = c => ({ company: c.company || "", contact: c.contact || "", email: c.email || "", phone: c.phone || "", address: c.address || "", zip: c.zip || "", city: c.city || "", vatNumber: c.vatNumber || "" });

export const CLIENT_FIELDS = [["company", "Société / Club / Association"], ["contact", "Nom du contact"], ["email", "Email", "email"], ["phone", "Téléphone", "tel"],
  ["address", "Adresse"], ["zip", "Code postal"], ["city", "Ville"], ["vatNumber", "N° TVA intracom. / SIRET"]];

export function clientModal(c, onSaved) {
  const isNew = !c;
  c = c || {};
  modal({
    title: isNew ? "Nouveau client" : c.company || c.contact || "Client",
    body: `<div class="grid g2">${CLIENT_FIELDS.map(([k, l, t]) => `<label class="f"><span>${l}</span><input type="${t || "text"}" name="${k}" value="${h(c[k])}"></label>`).join("")}
      <label class="f"><span>Remise habituelle</span><div class="input-group"><input type="number" name="discountPct" step="0.5" min="0" max="100" value="${h(c.discountPct ?? "")}"><span class="addon">%</span></div><div class="hint">Appliquée par défaut à ses nouveaux devis.</div></label>
      </div><label class="f" style="margin-top:12px"><span>Notes internes</span><textarea name="notes">${h(c.notes)}</textarea></label>`,
    actions: [
      ...(isNew ? [] : [{ label: "Supprimer", cls: "danger", icon: "trash", onClick: async () => {
        if (!(await confirmBox("Supprimer ce client ?", "Les devis existants sont conservés."))) return false;
        await api("DELETE", `/clients/${c.id}`); S.clients = S.clients.filter(x => x.id !== c.id); onSaved?.();
      } }]),
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async m => {
        const data = Object.fromEntries($$("[name]", m).map(i => [i.name, i.type === "number" ? num(i.value) : i.value.trim()]));
        if (!data.company && !data.contact) throw new Error("Indiquez au moins une société ou un contact.");
        const saved = isNew ? await api("POST", "/clients", data) : await api("PUT", `/clients/${c.id}`, data);
        S.clients = isNew ? [...S.clients, saved] : S.clients.map(x => x.id === saved.id ? saved : x);
        toast("Client enregistré");
        onSaved?.(saved);
      } },
    ],
  });
}

/* ---------------- Paramètres ---------------- */
function renderSettings(main) {
  const st = structuredClone(S.settings);
  const co = st.company;
  const f = (k, l, v, t = "text", extra = "") => `<label class="f"><span>${l}</span><input type="${t}" data-k="${k}" value="${h(v)}" ${extra}></label>`;
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Paramètres</h1><p>Vos informations, règles de calcul et textes par défaut.</p></div>
    <button class="btn primary" id="save">${icon("save")} Enregistrer</button></div>
  <div class="grid g2" style="align-items:start">
  <div class="stack">
    <div class="card"><div class="card-h"><h2>Mon entreprise</h2></div><div class="card-b">
      <div class="row" style="margin-bottom:14px;align-items:center"><div class="thumb" style="width:72px;height:72px" id="logoPrev">${co.logo ? `<img src="${h(co.logo)}">` : icon("image")}</div>
        <div><button class="btn sm" id="logoBtn">${icon("upload", "sm")} Logo</button> ${co.logo ? `<button class="btn sm ghost" id="logoDel">Retirer</button>` : ""}<div class="hint">Affiché sur les devis et le portail client.</div></div></div>
      <div class="grid g2">
        ${f("company.name", "Raison sociale", co.name)}${f("company.siret", "SIRET", co.siret)}
        ${f("company.address", "Adresse", co.address)}${f("company.zip", "Code postal", co.zip)}
        ${f("company.city", "Ville", co.city)}${f("company.vatNumber", "N° TVA intracom.", co.vatNumber)}
        ${f("company.email", "Email", co.email, "email")}${f("company.phone", "Téléphone", co.phone, "tel")}
        ${f("company.website", "Site web", co.website)}${f("company.iban", "IBAN (pour l'acompte)", co.iban)}
      </div></div></div>
    <div class="card"><div class="card-h"><h2>Textes par défaut</h2></div><div class="card-b stack">
      <label class="f"><span>Conditions générales (affichées sur chaque devis)</span><textarea data-k="conditions" rows="5">${h(st.conditions)}</textarea></label>
      <label class="f"><span>Délai de production par défaut</span><input type="text" data-k="leadTime" value="${h(st.leadTime)}"></label>
      <label class="f"><span>Points de contrôle du BAT (un par ligne — le client doit tous les cocher pour valider)</span><textarea data-k="batChecklist" rows="5">${h((st.batChecklist || []).join("\n"))}</textarea></label>
      <label class="f"><span>Signature des emails</span><textarea data-k="emailSignature" rows="3">${h(st.emailSignature)}</textarea></label>
    </div></div>
  </div>
  <div class="stack">
    <div class="card"><div class="card-h"><h2>Calcul & devis</h2></div><div class="card-b"><div class="grid g2">
      <label class="f"><span>Coefficient textile par défaut</span><div class="input-group"><input type="number" step="0.05" data-k="defaultCoef" value="${h(st.defaultCoef)}"><span class="addon">× achat</span></div><div class="hint">Prix de vente = prix d'achat × coef (modifiable par référence).</div></label>
      <label class="f"><span>TVA</span><div class="input-group"><input type="number" step="0.1" data-k="vatRate" value="${h(st.vatRate)}"><span class="addon">%</span></div></label>
      <label class="f"><span>Validité des devis</span><div class="input-group"><input type="number" data-k="validityDays" value="${h(st.validityDays)}"><span class="addon">jours</span></div></label>
      <label class="f"><span>Acompte demandé</span><div class="input-group"><input type="number" data-k="depositPct" value="${h(st.depositPct)}"><span class="addon">% TTC</span></div></label>
      <label class="f"><span>Préfixe de numérotation</span><input type="text" data-k="quotePrefix" value="${h(st.quotePrefix)}"></label>
      <label class="f"><span>Prochain numéro</span><input type="number" data-k="nextNumber" value="${h(st.nextNumber)}"></label>
    </div></div></div>
    <div class="card"><div class="card-h"><h2>Remises dégressives textile</h2><button class="btn sm" id="addDisc">${icon("plus", "sm")}</button></div><div class="card-b">
      <p class="hint" style="margin-top:0">Remise automatique sur le prix du textile selon la quantité de la ligne.</p><div id="discs"></div></div></div>
    <div class="card"><div class="card-h"><h2>Emplacements de marquage</h2></div><div class="card-b">
      <textarea data-k="positions" rows="4" placeholder="Un emplacement par ligne">${h((st.positions || []).join("\n"))}</textarea></div></div>
    <div class="card"><div class="card-h"><h2>Frais annexes prédéfinis</h2><button class="btn sm" id="addFee">${icon("plus", "sm")}</button></div><div class="card-b"><div id="fees"></div></div></div>
    <div class="card"><div class="card-h"><h2>Notifications & paiement</h2></div><div class="card-b stack">
      ${f("notifyEmail", "Email de notification (actions des clients)", st.notifyEmail, "email", `placeholder="${h(co.email || "vous@exemple.fr")}"`)}
      <div class="hint">${S.mailEnabled ? badge("SMTP configuré", "success") + " Les emails partent directement de l'outil." : badge("SMTP non configuré", "neutral") + " Renseignez SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM dans le fichier .env pour envoyer les emails depuis l'outil. Sinon, l'outil ouvre votre messagerie avec le message pré-rempli."}</div>
      <label class="check"><input type="checkbox" data-k="onlinePayment" ${st.onlinePayment ? "checked" : ""} ${S.stripeEnabled ? "" : "disabled"}> Proposer le paiement de l'acompte par carte (Stripe)</label>
      ${S.stripeEnabled ? "" : `<div class="hint">Nécessite STRIPE_SECRET_KEY dans .env.</div>`}
    </div></div>
    <div class="card"><div class="card-h"><h2>Sauvegarde</h2></div><div class="card-b row">
      <button class="btn" id="bk">${icon("download")} Exporter toutes les données</button>
      <button class="btn" id="rs">${icon("upload")} Restaurer</button></div></div>
  </div></div>`;

  const drawDiscs = () => {
    $("#discs").innerHTML = (st.textileDiscounts || []).map((d, i) => `<div class="row" style="margin-bottom:8px">
      <span>À partir de</span><input type="number" class="sm" style="width:90px" data-d="${i}" data-f="min" value="${h(d.min)}"><span>pièces :</span>
      <div class="input-group" style="width:110px"><input type="number" class="sm" step="0.5" data-d="${i}" data-f="pct" value="${h(d.pct)}"><span class="addon">%</span></div>
      <button class="btn sm ghost icon" data-dd="${i}">${icon("trash", "sm")}</button></div>`).join("") || `<small class="muted">Aucune remise dégressive.</small>`;
    $$("[data-d]").forEach(i => i.oninput = () => st.textileDiscounts[i.dataset.d][i.dataset.f] = num(i.value) ?? 0);
    $$("[data-dd]").forEach(b => b.onclick = () => { st.textileDiscounts.splice(b.dataset.dd, 1); drawDiscs(); });
  };
  const drawFees = () => {
    $("#fees").innerHTML = (st.extraFees || []).map((x, i) => `<div class="row" style="margin-bottom:8px;flex-wrap:nowrap">
      <input type="text" class="sm" data-fe="${i}" data-f="label" value="${h(x.label)}" placeholder="Libellé">
      <div class="input-group" style="width:130px;flex:none"><input type="number" class="sm" step="0.01" data-fe="${i}" data-f="unit" value="${h(x.unit)}"><span class="addon">€</span></div>
      <label class="check" style="flex:none" title="Multiplié par le nombre de pièces"><input type="checkbox" data-fe="${i}" data-f="perPiece" ${x.perPiece ? "checked" : ""}><small>/pièce</small></label>
      <button class="btn sm ghost icon" data-fd="${i}">${icon("trash", "sm")}</button></div>`).join("");
    $$("[data-fe]").forEach(i => i.oninput = () => st.extraFees[i.dataset.fe][i.dataset.f] = i.type === "checkbox" ? i.checked : i.type === "number" ? num(i.value) ?? 0 : i.value);
    $$("[data-fd]").forEach(b => b.onclick = () => { st.extraFees.splice(b.dataset.fd, 1); drawFees(); });
  };
  drawDiscs(); drawFees();
  $("#addDisc").onclick = () => { (st.textileDiscounts ||= []).push({ min: 100, pct: 5 }); drawDiscs(); };
  $("#addFee").onclick = () => { (st.extraFees ||= []).push({ id: uid("f"), label: "", unit: 0, perPiece: false }); drawFees(); };
  $("#logoBtn").onclick = async () => {
    const [file] = await pickFiles({ accept: "image/*", multiple: false });
    if (!file) return;
    try { const r = await uploadFile(file); co.logo = r.url; $("#logoPrev").innerHTML = `<img src="${h(r.url)}">`; toast("Logo chargé — pensez à enregistrer"); } catch (e) { fail(e); }
  };
  if ($("#logoDel")) $("#logoDel").onclick = () => { co.logo = ""; $("#logoPrev").innerHTML = icon("image"); };
  $("#save").onclick = async () => {
    for (const el of $$("[data-k]", main)) {
      const path = el.dataset.k.split(".");
      let v = el.type === "checkbox" ? el.checked : el.type === "number" ? num(el.value) : el.value;
      if (["positions", "batChecklist"].includes(el.dataset.k)) v = el.value.split("\n").map(s => s.trim()).filter(Boolean);
      if (path.length === 2) st[path[0]][path[1]] = v; else st[path[0]] = v;
    }
    st.textileDiscounts = (st.textileDiscounts || []).filter(d => d.min > 0).sort((a, b) => a.min - b.min);
    st.extraFees = (st.extraFees || []).filter(x => x.label);
    try { S.settings = await api("PUT", "/settings", st); toast("Paramètres enregistrés"); renderShell(); route(); } catch (e) { fail(e); }
  };
  $("#bk").onclick = async () => {
    try { download(`sauvegarde-devis-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await api("GET", "/backup"), null, 2), "application/json"); } catch (e) { fail(e); }
  };
  $("#rs").onclick = async () => {
    const [file] = await pickFiles({ accept: "application/json,.json", multiple: false });
    if (!file) return;
    if (!(await confirmBox("Restaurer la sauvegarde ?", "Toutes les données actuelles (devis, références, tarifs, clients, paramètres) seront remplacées.", { label: "Restaurer", danger: true }))) return;
    try { await api("POST", "/restore", JSON.parse(await readAsText(file))); toast("Données restaurées"); await boot(); } catch (e) { fail(e); }
  };
}

/* ---------------- Démarrage ---------------- */
if (S.pw) boot().catch(() => renderLogin()); else renderLogin();
