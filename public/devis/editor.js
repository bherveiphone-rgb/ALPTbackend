/* Éditeur de devis : lignes, marquages, calcul en direct, BAT, échanges. */
import { S, api, isEmp, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, ago, uid, num, clone, uploadFile, bindDrop, lightbox, pickFiles } from "./ui.js";
import { computeQuote, lineQty, resolveFormat, lineIncluded, QUOTE_STATUSES, BAT_STATUSES, batStatusOf } from "./pricing.js";
import { reloadQuotes, clientModal, clientSnapshot, CLIENT_FIELDS, statusBadge, batBadge, newQuote } from "./app.js";
import { emailComposer, taskModal, activityModal } from "./contacts.js";
import { render as renderTpl } from "./tpl.js";
import { saveAsTemplate } from "./achats.js";
import { createShop } from "./boutiques.js";

/** Variables des modèles d'emails pour ce devis (mêmes noms que côté serveur). */
function tplVars(q, extra = {}) {
  const T = q.computed?.totals || {};
  return {
    contact: q.client?.contact || "", client: q.client?.company || q.client?.contact || "", numero: q.number, objet: q.title || "votre projet",
    lien: q.link, montant_ht: fmtEUR(T.ht), montant_ttc: fmtEUR(T.ttc), acompte: fmtEUR(T.deposit), atelier: S.settings.company.name,
    signature: S.settings.emailSignature || S.settings.company.name || "", date_limite: q.validUntil ? new Date(q.validUntil).toLocaleDateString("fr-FR") : "",
    version: (q.bats || []).length, ...extra,
  };
}

const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
/** Univers d'une ligne : textile, objet ou print (imprimés). */
const lineUni = l => (l.kind === "print" ? "print" : l.universe || "textile");
const techsOf = (u, current) => E.techniques.filter(t => (t.universe || "textile") === u || t.id === current);
const E = { q: null, techniques: [], dirty: false, tab: "devis", c: null, setupKeys: "", staged: [] };

/* -------- Garde-fou : modifications non enregistrées -------- */
export async function editorGuard() {
  if (!E.dirty || !E.q) return true;
  const ok = await confirmBox("Modifications non enregistrées", "Voulez-vous quitter ce devis sans enregistrer ?", { label: "Quitter sans enregistrer", danger: true });
  if (ok) { E.dirty = false; E.q = null; }
  return ok;
}
window.addEventListener("beforeunload", e => { if (E.dirty) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && E.q && location.hash.startsWith("#/devis/")) { e.preventDefault(); save(); }
});

const setDirty = (v = true) => {
  E.dirty = v;
  const el = $("#dirty");
  if (el) el.classList.toggle("hidden", !v);
};

async function save(silent = false) {
  const q = E.q;
  try {
    const saved = await api("PUT", `/quotes/${q.id}`, {
      title: q.title, clientId: q.clientId, client: q.client, lines: q.lines, fees: q.fees, discountPct: q.discountPct,
      shipping: q.shipping, vatRate: q.vatRate, depositPct: q.depositPct, validUntil: q.validUntil, leadTime: q.leadTime, deadline: q.deadline,
      notes: q.notes, internalNotes: q.internalNotes, setupOverrides: q.setupOverrides, status: q.status, choices: q.choices || {},
    });
    load(saved);
    setDirty(false);
    if (!silent) toast("Devis enregistré");
    reloadQuotes();
    return true;
  } catch (e) { fail(e); return false; }
}
function load(q) {
  E.q = q; E.c = null;
  E.techniques = q.techniques || S.techniques;
  // une technique ajoutée depuis la création du devis reste disponible
  for (const t of S.techniques) if (!E.techniques.some(x => x.id === t.id)) E.techniques.push(t);
}

/* ================================================================ */
export async function renderEditor(main, id) {
  main.innerHTML = `<div class="empty">Chargement…</div>`;
  try { load(await api("GET", `/quotes/${id}`)); } catch (e) { main.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  E.dirty = false; E.staged = []; E.setupKeys = "";
  reloadQuotes();
  drawPage(main);
}

function drawPage(main = $("#main")) {
  const q = E.q;
  const msgCount = (q.messages || []).length;
  main.innerHTML = `
  <div class="page-head">
    <a class="btn icon ghost" href="#/devis" title="Retour">${icon("back")}</a>
    <div class="grow"><div class="row" style="gap:8px"><h1 class="num">${h(q.number)}</h1><span id="hdrStatus">${statusBadge(q.status)} ${batBadge(batStatusOf(q))}</span>
      <span id="dirty" class="badge t-warning ${E.dirty ? "" : "hidden"}">Non enregistré</span></div>
      <p>${h(q.client?.company || q.client?.contact || "Nouveau client")} · créé le ${fmtDate(q.createdAt)}${q.viewedAt ? ` · ${icon("eye", "sm")} vu par le client ${ago(q.viewedAt)}` : ""}</p></div>
    <button class="btn" id="preview" title="Voir ce que voit le client">${icon("eye")} Aperçu</button>
    <button class="btn" id="pdf" title="Imprimer / enregistrer en PDF">${icon("print")} PDF</button>
    <button class="btn" id="sendBtn">${icon("send")} Envoyer</button>
    <button class="btn primary" id="saveBtn" title="Ctrl + S">${icon("save")} Enregistrer</button>
  </div>
  <div class="tabs">
    <button data-tab="devis" class="${E.tab === "devis" ? "on" : ""}">${icon("file", "sm")} Devis</button>
    <button data-tab="bat" class="${E.tab === "bat" ? "on" : ""}">${icon("image", "sm")} BAT <span class="count">${(q.bats || []).length}</span></button>
    <button data-tab="suivi" class="${E.tab === "suivi" ? "on" : ""}">${icon("msg", "sm")} Échanges & suivi <span class="count">${msgCount}</span></button>
  </div>
  <div id="tabBody"></div>`;
  $$(".tabs [data-tab]").forEach(b => b.onclick = () => { E.tab = b.dataset.tab; drawPage(); });
  $("#saveBtn").onclick = () => save();
  $("#preview").onclick = () => openClient("preview=1");
  $("#pdf").onclick = () => openClient("print=1");
  $("#sendBtn").onclick = () => sendModal();
  ({ devis: drawQuoteTab, bat: drawBatTab, suivi: drawFollowTab })[E.tab]($("#tabBody"));
}

async function openClient(param) {
  if (E.dirty && !(await save(true))) return;
  window.open(`client.html?t=${encodeURIComponent(E.q.token)}&${param}`, "_blank");
}

/* ================================================================
   ONGLET DEVIS
   ================================================================ */
function drawQuoteTab(body) {
  const q = E.q;
  const validDate = q.validUntil ? new Date(q.validUntil).toISOString().slice(0, 10) : "";
  body.innerHTML = `<div class="editor">
  <div class="stack" id="left">
    <div class="card"><div class="card-h"><h2>Client</h2>
      <div class="ac" style="width:min(320px,55%)"><input type="search" id="clientSearch" class="sm" placeholder="Rechercher un client existant…" autocomplete="off"><div class="ac-list hidden" id="clientAc"></div></div>
    </div><div class="card-b">
      <div class="grid g4" id="clientFields">${CLIENT_FIELDS.map(([k, l, t]) => `<label class="f"><span>${l}</span><input type="${t || "text"}" class="sm" data-cl="${k}" value="${h(q.client?.[k])}"></label>`).join("")}</div>
      <div class="row" style="margin-top:10px" id="clientLinkRow"></div>
    </div></div>

    <div class="card"><div class="card-h"><h2>Informations</h2></div><div class="card-b"><div class="grid g3">
      <label class="f" style="grid-column:span 3"><span>Objet du devis</span><input type="text" id="title" value="${h(q.title)}" placeholder="Ex. : Tenues saison 2026 — section running"></label>
      <label class="f"><span>Valable jusqu'au</span><input type="date" id="validUntil" value="${validDate}"></label>
      <label class="f"><span>Livraison souhaitée le</span><input type="date" id="deadline" value="${q.deadline ? new Date(q.deadline).toISOString().slice(0, 10) : ""}"></label>
      <label class="f"><span>Délai de production</span><input type="text" id="leadTime" value="${h(q.leadTime)}"></label>
    </div></div></div>

    <div>
      <div class="row between" style="margin-bottom:10px"><h2>Articles & marquages</h2><small class="muted" id="qtyTotal"></small></div>
      <div id="lines"></div>
      <div class="add-bar">
        <button class="btn primary" id="addArticle">${icon("shirt")} Ajouter une référence</button>
        <button class="btn" id="addObject">${icon("sparkle")} Objet personnalisé</button>
        <button class="btn" id="addPrint">${icon("print")} Imprimé (print)</button>
        <button class="btn" id="addFree">${icon("plus")} Article libre</button>
        <button class="btn" id="addSupplied">${icon("brush")} Marquage seul (textile fourni)</button>
      </div>
    </div>

    <div class="card"><div class="card-h"><h2>Frais techniques</h2><small class="muted">Calculés une fois par visuel — modifiables</small></div><div class="card-b" id="setups"></div></div>

    <div class="card"><div class="card-h"><h2>Frais annexes, remise & port</h2>
      <select class="sm" id="feePreset" style="width:auto"><option value="">+ Ajouter un frais…</option>${(S.settings.extraFees || []).map(f => `<option value="${h(f.id)}">${h(f.label)} — ${fmtEUR(f.unit)}${f.perPiece ? "/pièce" : ""}</option>`).join("")}<option value="__custom">Frais personnalisé</option></select>
    </div><div class="card-b"><div id="fees"></div>
      <div class="grid g4" style="margin-top:12px">
        <label class="f"><span>Remise globale</span><div class="input-group"><input type="number" class="sm" id="discountPct" step="0.5" min="0" value="${h(q.discountPct || "")}" placeholder="0"><span class="addon">%</span></div></label>
        <label class="f"><span>Frais de port HT</span><div class="input-group"><input type="number" class="sm" id="shipping" step="0.01" min="0" value="${h(q.shipping || "")}" placeholder="0"><span class="addon">€</span></div></label>
        <label class="f"><span>Acompte</span><div class="input-group"><input type="number" class="sm" id="depositPct" step="1" min="0" max="100" value="${h(q.depositPct ?? "")}"><span class="addon">%</span></div></label>
        <label class="f"><span>TVA</span><div class="input-group"><input type="number" class="sm" id="vatRate" step="0.1" value="${h(q.vatRate ?? S.settings.vatRate)}"><span class="addon">%</span></div></label>
      </div></div></div>

    <div class="card"><div class="card-h"><h2>Notes</h2></div><div class="card-b grid g2">
      <label class="f"><span>Message au client (visible sur le devis)</span><textarea id="notes" rows="4">${h(q.notes)}</textarea></label>
      <label class="f"><span>${icon("lock", "sm")} Notes internes (jamais visibles)</span><textarea id="internalNotes" rows="4">${h(q.internalNotes)}</textarea></label>
    </div></div>
  </div>
  <aside class="summary"><div class="card" id="summary"></div></aside>
  </div>`;

  // Champs simples
  const bind = (id, fn) => $("#" + id).addEventListener("input", e => { fn(e.target.value); setDirty(); recalc(); });
  bind("title", v => q.title = v);
  bind("leadTime", v => q.leadTime = v);
  bind("deadline", v => q.deadline = v ? new Date(v + "T12:00:00").getTime() : null);
  bind("validUntil", v => q.validUntil = v ? new Date(v + "T23:59:00").getTime() : null);
  bind("discountPct", v => q.discountPct = num(v) ?? 0);
  bind("shipping", v => q.shipping = num(v) ?? 0);
  bind("depositPct", v => q.depositPct = num(v) ?? 0);
  bind("vatRate", v => q.vatRate = num(v) ?? 0);
  bind("notes", v => q.notes = v);
  bind("internalNotes", v => q.internalNotes = v);
  $$("[data-cl]").forEach(i => i.oninput = () => { (q.client ||= {})[i.dataset.cl] = i.value; setDirty(); });
  bindClientSearch();
  drawClientLink();

  $("#addArticle").onclick = () => articlePicker(a => addLineFromArticle(a));
  $("#addObject").onclick = () => articlePicker(a => addLineFromArticle(a), "objet");
  $("#addPrint").onclick = () => printPicker(t => addLine({
    kind: "print", universe: "print", supplied: true, name: t.name, availableSizes: ["Quantité"], sizes: {}, colors: [], color: "",
    perso: [{ id: uid("p"), techniqueId: t.id, formatId: t.formats?.[0]?.id || "", options: defaultOptions(t), position: "", w: "", h: "", colors: 1, design: "Visuel" }],
  }));
  $("#addFree").onclick = () => addLine({ name: "", ref: "", cost: 0, availableSizes: ["Unique"], sizes: {} }, true);
  $("#addSupplied").onclick = () => addLine({ name: "Textile fourni par le client", supplied: true, availableSizes: ["Unique"], sizes: {} }, true);
  $("#feePreset").onchange = e => {
    const v = e.target.value; e.target.value = "";
    if (!v) return;
    const p = S.settings.extraFees.find(f => f.id === v);
    const qty = p?.perPiece ? Math.max(1, E.c?.totals.qty || 1) : 1;
    (q.fees ||= []).push(p ? { id: uid("fe"), label: p.label, qty, unit: p.unit } : { id: uid("fe"), label: "", qty: 1, unit: 0 });
    setDirty(); drawFees(); recalc();
    if (!p) $$("#fees [data-fe-label]").pop()?.focus();
  };

  drawLines(); drawFees(); recalc();
}

/* -------- Client -------- */
function bindClientSearch() {
  const inp = $("#clientSearch"), list = $("#clientAc");
  const draw = () => {
    const s = inp.value.toLowerCase().trim();
    const res = S.clients.filter(c => !s || [c.company, c.contact, c.email].join(" ").toLowerCase().includes(s)).slice(0, 8);
    list.innerHTML = res.map(c => `<div class="ac-item" data-id="${c.id}"><div class="thumb" style="width:30px;height:30px">${icon("users", "sm")}</div><div><b>${h(c.company || c.contact)}</b><small class="muted">${h([c.contact, c.email].filter(Boolean).join(" · "))}</small></div></div>`).join("")
      + `<div class="ac-item" data-new><div class="thumb" style="width:30px;height:30px">${icon("plus", "sm")}</div><b>Créer un nouveau client</b></div>`;
    list.classList.remove("hidden");
    $$("[data-id]", list).forEach(el => el.onmousedown = () => pickClient(S.clients.find(c => c.id === el.dataset.id)));
    $("[data-new]", list).onmousedown = () => clientModal(null, c => c && pickClient(c));
  };
  inp.onfocus = draw; inp.oninput = draw;
  inp.onblur = () => setTimeout(() => list.classList.add("hidden"), 150);
}
function pickClient(c) {
  const q = E.q;
  q.clientId = c.id;
  q.client = clientSnapshot(c);
  if (c.discountPct && !q.discountPct) { q.discountPct = c.discountPct; toast(`Remise client de ${c.discountPct} % appliquée`); }
  setDirty();
  drawQuoteTab($("#tabBody"));
}
function drawClientLink() {
  const q = E.q, row = $("#clientLinkRow");
  const c = S.clients.find(x => x.id === q.clientId);
  row.innerHTML = c
    ? `${badge("Client enregistré", "success")}<small class="muted">Lié à la fiche « ${h(c.company || c.contact)} »${c.discountPct ? ` · remise habituelle ${c.discountPct} %` : ""}</small><span class="spacer"></span><a class="btn sm" href="#/contacts/${c.id}">${icon("users", "sm")} Voir la fiche</a><button class="btn sm ghost" id="unlink">Délier</button>`
    : `<small class="muted">Client non enregistré.</small><span class="spacer"></span><button class="btn sm" id="saveClient">${icon("save", "sm")} Enregistrer dans mes clients</button>`;
  if (c) $("#unlink").onclick = () => { q.clientId = null; setDirty(); drawClientLink(); };
  else $("#saveClient").onclick = async () => {
    if (!q.client?.company && !q.client?.contact) return fail("Renseignez au moins la société ou le contact.");
    try {
      const saved = await api("POST", "/clients", q.client);
      S.clients.push(saved); q.clientId = saved.id; setDirty(); drawClientLink(); toast("Client enregistré");
    } catch (e) { fail(e); }
  };
}

/* -------- Sélecteur de références -------- */
export function articlePicker(onPick, universe = "textile") {
  const pool = S.catalog.filter(a => (a.universe || "textile") === universe);
  const cats = [...new Set(pool.map(a => a.category).filter(Boolean))];
  const m = modal({
    title: universe === "objet" ? "Ajouter un objet personnalisé" : "Ajouter une référence textile", size: "wide",
    body: `<div class="row" style="margin-bottom:12px"><div class="search" style="max-width:none">${icon("search", "sm")}<input type="search" id="apS" placeholder="Référence, nom, marque…"></div>
      <select id="apC" style="width:180px"><option value="">Toutes catégories</option>${cats.map(c => `<option>${h(c)}</option>`).join("")}</select></div>
      <div id="apL" style="max-height:55vh;overflow:auto"></div>`,
  });
  const draw = () => {
    const s = $("#apS", m.el).value.toLowerCase(), cat = $("#apC", m.el).value;
    const list = pool.filter(a => (!cat || a.category === cat) && (!s || [a.ref, a.name, a.brand, a.category].join(" ").toLowerCase().includes(s)));
    $("#apL", m.el).innerHTML = list.length ? `<table class="t"><tbody>${list.map(a => `<tr class="click" data-a="${a.id}">
      <td style="width:56px"><div class="thumb">${a.image ? `<img src="${h(a.image)}">` : icon(universe === "objet" ? "sparkle" : "shirt", "sm")}</div></td>
      <td><b>${h(a.name)}</b><br><small>${h([a.ref, a.brand, a.category].filter(Boolean).join(" · "))}</small></td>
      <td><small>${h((a.colors || []).slice(0, 4).join(", "))}${(a.colors || []).length > 4 ? "…" : ""}</small></td>
      <td class="r num">${isEmp() ? "" : `<small class="muted">achat ${fmtEUR(a.cost)}</small>`}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Aucune référence trouvée. <a href="#/references">Gérer les références</a></div>`;
    $$("[data-a]", m.el).forEach(r => r.onclick = () => { m.close(); onPick(S.catalog.find(a => a.id === r.dataset.a)); });
  };
  $("#apS", m.el).oninput = draw; $("#apC", m.el).onchange = draw;
  draw();
}

/** Choix d'un produit imprimé (flyers, cartes, affiches…). */
function printPicker(onPick) {
  const list = E.techniques.filter(t => t.universe === "print");
  const m = modal({
    title: "Ajouter un imprimé", size: "wide",
    body: list.length ? `<div class="grid g2">${list.map(t => `<button class="card tech-card" data-t="${h(t.id)}" style="text-align:left;border:1px solid var(--border)"><div class="ic" style="background:${h(t.color)}">${icon("print")}</div><div><b>${h(t.name)}</b><br><small class="muted">${h(t.description || "")}</small><br><small>${(t.formats || []).map(f => h(f.label)).join(" · ")}</small></div></button>`).join("")}</div>`
      : `<div class="empty">Aucun produit imprimé. Créez-en un dans <a href="#/techniques">Marquages & tarifs</a> (univers « Print »).</div>`,
  });
  $$("[data-t]", m.el).forEach(b => b.onclick = () => { m.close(); onPick(list.find(t => t.id === b.dataset.t)); });
}
/** Options par défaut : la première de chaque groupe (ex. papier standard). */
const defaultOptions = t => { const seen = new Set(); return (t.options || []).filter(o => o.group && !seen.has(o.group) && seen.add(o.group)).map(o => o.id); };

export const lineFromArticle = a => ({
  id: uid("l"), universe: a.universe || "textile", articleId: a.id, ref: a.ref, name: a.name, brand: a.brand, image: a.image, cost: a.cost, coef: a.coef,
  salePrice: a.salePrice, sizeSurcharges: a.sizeSurcharges || {}, availableSizes: a.sizes?.length ? a.sizes : ["Unique"],
  colors: a.colors || [], color: a.colors?.[0] || "", sizes: {}, perso: [],
});
function addLineFromArticle(a) { addLine(lineFromArticle(a)); }
function addLine(l, focusName = false) {
  E.q.lines.push({ id: uid("l"), perso: [], sizes: {}, ...l });
  setDirty(); drawLines(); recalc();
  const last = $$("#lines .line").pop();
  last?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => (focusName ? $("[data-f=name]", last) : $(".size-cell input", last))?.focus(), 250);
}

/* -------- Lignes -------- */
function drawLines() {
  const q = E.q, box = $("#lines");
  if (!q.lines.length) {
    box.innerHTML = `<div class="card empty"><div class="ico">${icon("shirt")}</div><b>Aucun article</b><p>Ajoutez une référence de votre catalogue, puis indiquez les quantités par taille et les marquages.</p></div>`;
    return;
  }
  const positions = S.settings.positions || [];
  box.innerHTML = `<datalist id="positions">${positions.map(p => `<option value="${h(p)}">`).join("")}</datalist>` + q.lines.map((l, i) => {
    const sizes = l.availableSizes?.length ? l.availableSizes : DEFAULT_SIZES;
    const custom = !l.articleId;
    const uni = lineUni(l), isPrint = uni === "print";
    return `<div class="line" data-line="${l.id}">
    <div class="line-h">
      <span class="line-num">${i + 1}</span>
      <div class="thumb">${l.image ? `<img src="${h(l.image)}">` : icon(isPrint ? "print" : uni === "objet" ? "sparkle" : l.supplied ? "brush" : "shirt", "sm")}</div>
      <div class="title">${custom
        ? `<div class="row" style="gap:6px;flex-wrap:nowrap"><input class="sm" data-f="name" value="${h(l.name)}" placeholder="Désignation de l'article"><input class="sm" style="width:110px" data-f="ref" value="${h(l.ref)}" placeholder="Réf."></div>`
        : `<b>${h(l.name)}</b><small class="muted">${h([l.ref, l.brand].filter(Boolean).join(" · "))}</small>`}</div>
      ${isPrint ? "" : l.colors?.length ? `<select class="sm" data-f="color" style="width:150px">${l.colors.map(c => `<option ${c === l.color ? "selected" : ""}>${h(c)}</option>`).join("")}<option value="__other">Autre…</option></select>`
        : `<input class="sm" data-f="color" style="width:150px" value="${h(l.color)}" placeholder="${uni === "objet" ? "Couleur" : "Couleur textile"}">`}
      <button class="btn sm ghost icon" data-act="up" title="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="btn sm ghost icon" data-act="dup" title="Dupliquer (ex. autre couleur)">${icon("copy", "sm")}</button>
      <button class="btn sm ghost icon" data-act="del" title="Supprimer">${icon("trash", "sm")}</button>
    </div>
    <div class="line-b">
      <div class="row" style="gap:8px;font-size:13px">
        <select class="sm" data-mode style="width:170px" title="Une option ou une variante est proposée au client, qui choisit sur son espace">
          <option value="normal" ${(l.mode || "normal") === "normal" ? "selected" : ""}>Ligne incluse</option>
          <option value="option" ${l.mode === "option" ? "selected" : ""}>Option facultative</option>
          <option value="variant" ${l.mode === "variant" ? "selected" : ""}>Variante (au choix)</option></select>
        ${l.mode === "variant" ? `<input class="sm" data-group style="width:170px" value="${h(l.group || "")}" placeholder="Groupe (ex. Marquage dos)">` : ""}
        ${l.mode === "option" ? `<label class="check"><input type="checkbox" data-incl ${q.choices?.options?.[l.id] ? "checked" : ""}> retenue (incluse dans le total)</label>` : ""}
        ${l.mode === "variant" ? `<label class="check"><input type="radio" name="vg-${h(l.group || "")}" data-incl ${lineIncluded(q, l) ? "checked" : ""}> variante retenue</label>` : ""}
        <span data-alt="${l.id}" class="muted"></span>
      </div>
      <div><div class="section-lbl">${isPrint ? "Quantité (exemplaires)" : uni === "objet" ? "Quantité" : "Quantités par taille"} ${isPrint || uni === "objet" ? "" : `<button class="link-btn" data-act="addsize" style="font-size:11.5px;text-transform:none;letter-spacing:0">+ taille</button>`}</div>
        <div class="sizes">${sizes.map(s => `<label class="size-cell"><span>${h(s)}</span><input type="number" min="0" inputmode="numeric" data-size="${h(s)}" value="${l.sizes?.[s] || ""}" placeholder="0">${!isEmp() && num(l.sizeSurcharges?.[s]) ? `<small class="sur">+${fmtEUR(l.sizeSurcharges[s])}</small>` : ""}</label>`).join("")}</div>
      </div>
      ${l.supplied ? "" : `<div><div class="section-lbl">${uni === "objet" ? "Objet" : "Textile"}</div><div class="textile-row">
        ${isEmp() ? "" : `<label class="f"><span>Prix d'achat HT</span><div class="input-group"><input type="number" class="sm" step="0.01" data-f="cost" value="${h(l.cost ?? "")}"><span class="addon">€</span></div></label>
        <label class="f"><span>Coefficient</span><div class="input-group"><input type="number" class="sm" step="0.05" data-f="coef" value="${h(l.coef ?? "")}" placeholder="${h(S.settings.defaultCoef)}"><span class="addon">×</span></div></label>`}
        <label class="f"><span>PU vente HT <small class="faint">(forcer)</small></span><div class="input-group"><input type="number" class="sm ${num(l.priceOverride) !== null ? "ov" : ""}" step="0.01" data-f="priceOverride" value="${h(l.priceOverride ?? "")}" data-tu="${l.id}"><span class="addon">€</span></div></label>
        <div class="f"><span style="display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:5px">Remise qté</span><div data-disc="${l.id}" style="height:30px;display:flex;align-items:center"></div></div>
      </div></div>`}
      <div><div class="section-lbl">${isPrint ? "Impression" : "Marquages"}</div>
        <div data-persos>${(l.perso || []).map(p => persoRow(l, p)).join("") || `<small class="muted">Aucun marquage — article vendu neutre.</small>`}</div>
        ${isPrint ? "" : `<button class="btn sm" data-act="addperso" style="margin-top:10px">${icon("plus", "sm")} Ajouter un marquage</button>`}
      </div>
      <label class="f"><span>Remarque sur la ligne (visible client)</span><input type="text" class="sm" data-f="note" value="${h(l.note)}" placeholder="Ex. : prénoms au dos selon liste jointe"></label>
    </div>
    <div class="line-f" data-lf="${l.id}"></div>
  </div>`;
  }).join("");

  // Évènements par ligne
  for (const el of $$("#lines .line")) {
    const l = q.lines.find(x => x.id === el.dataset.line);
    $("[data-mode]", el).onchange = e => { l.mode = e.target.value; if (l.mode === "variant" && !l.group) l.group = "Variante"; setDirty(); drawLines(); recalc(); };
    const grp = $("[data-group]", el);
    if (grp) grp.onchange = () => { l.group = grp.value.trim(); setDirty(); drawLines(); recalc(); };
    const incl = $("[data-incl]", el);
    if (incl) incl.onchange = () => {
      q.choices ||= {}; q.choices.options ||= {}; q.choices.variants ||= {};
      if (l.mode === "option") q.choices.options[l.id] = incl.checked;
      else q.choices.variants[l.group || ""] = l.id;
      setDirty(); drawLines(); recalc();
    };
    $$("[data-size]", el).forEach(i => i.oninput = () => {
      const v = Math.max(0, parseInt(i.value, 10) || 0);
      if (v) l.sizes[i.dataset.size] = v; else delete l.sizes[i.dataset.size];
      setDirty(); recalc();
    });
    $$(".line-h [data-f], .line-b > label [data-f], .textile-row [data-f]", el).forEach(i => i.oninput = i.onchange = () => {
      const f = i.dataset.f;
      if (f === "color" && i.value === "__other") {
        const c = prompt("Couleur du textile :");
        if (c) { l.colors = [...(l.colors || []), c]; l.color = c; }
        drawLines(); recalc(); setDirty(); return;
      }
      l[f] = ["cost", "coef", "priceOverride"].includes(f) ? num(i.value) : i.value;
      if (f === "priceOverride") i.classList.toggle("ov", num(i.value) !== null);
      setDirty(); recalc();
    });
    $$("[data-act]", el).forEach(b => b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "del") {
        if (!(await confirmBox("Supprimer cette ligne ?", h(l.name || "Article")))) return;
        q.lines = q.lines.filter(x => x !== l);
      } else if (act === "dup") {
        const c = clone(l); c.id = uid("l"); c.sizes = {};
        c.perso.forEach(p => p.id = uid("p"));
        q.lines.splice(q.lines.indexOf(l) + 1, 0, c);
        toast("Ligne dupliquée : choisissez la couleur et les quantités");
      } else if (act === "up") {
        const i = q.lines.indexOf(l); q.lines.splice(i, 1); q.lines.splice(i - 1, 0, l);
      } else if (act === "addsize") {
        const s = prompt("Nom de la taille (ex. 4XL, 10 ans, Unique) :");
        if (!s?.trim()) return;
        l.availableSizes = [...new Set([...(l.availableSizes?.length ? l.availableSizes : DEFAULT_SIZES), s.trim()])];
      } else if (act === "addperso") {
        const prev = l.perso[l.perso.length - 1];
        const t = E.techniques.find(x => x.id === prev?.techniqueId) || techsOf(lineUni(l))[0] || E.techniques[0];
        const used = new Set(l.perso.map(p => p.position));
        l.perso.push({ id: uid("p"), techniqueId: t?.id, position: (S.settings.positions || []).find(p => !used.has(p)) || "", w: "", h: "", formatId: "", colors: 1, design: "" });
      }
      setDirty(); drawLines(); recalc();
    });
    $$("[data-perso]", el).forEach(row => {
      const p = l.perso.find(x => x.id === row.dataset.perso);
      $$("[data-pf]", row).forEach(i => i.oninput = i.onchange = () => {
        const f = i.dataset.pf;
        p[f] = ["w", "h", "colors", "unitOverride"].includes(f) ? num(i.value) : i.value;
        if (f === "techniqueId") {
          const t = E.techniques.find(x => x.id === p.techniqueId);
          p.formatId = lineUni(l) === "print" ? t?.formats?.[0]?.id || "" : ""; p.unitOverride = null; p.options = t ? defaultOptions(t) : [];
          if (lineUni(l) === "print" && t) l.name = t.name;
          setDirty(); drawLines(); recalc(); return;
        }
        if (f === "unitOverride") i.classList.toggle("ov", num(i.value) !== null);
        setDirty(); recalc();
      });
      // options (papier, recto-verso, finitions…) : listes par groupe + cases à cocher
      $$("[data-pog]", row).forEach(sel => sel.onchange = () => {
        const t = E.techniques.find(x => x.id === p.techniqueId);
        const groupIds = (t?.options || []).filter(o => o.group === sel.dataset.pog).map(o => o.id);
        p.options = [...(p.options || []).filter(id => !groupIds.includes(id)), ...(sel.value ? [sel.value] : [])];
        setDirty(); recalc();
      });
      $$("[data-pochk]", row).forEach(c => c.onchange = () => {
        p.options = (p.options || []).filter(id => id !== c.dataset.pochk);
        if (c.checked) p.options.push(c.dataset.pochk);
        setDirty(); recalc();
      });
      const del = $("[data-pdel]", row);
      if (del) del.onclick = () => { l.perso = l.perso.filter(x => x !== p); setDirty(); drawLines(); recalc(); };
    });
  }
}

function optionsUI(t, p) {
  const opts = t?.options || [];
  if (!opts.length) return "";
  const sel = new Set(p.options || []);
  const groups = [...new Set(opts.filter(o => o.group).map(o => o.group))];
  const fmtVal = o => o.type === "pct" ? (o.value ? ` (+${o.value} %)` : "") : o.type === "unit" ? ` (+${fmtEUR(o.value)}/u)` : ` (+${fmtEUR(o.value)})`;
  return `<div class="row" style="grid-column:1/-1;gap:8px 14px">
    ${groups.map(g => `<label class="f" style="min-width:170px"><span>${h(g)}</span><select class="sm" data-pog="${h(g)}"><option value="">—</option>${opts.filter(o => o.group === g).map(o => `<option value="${h(o.id)}" ${sel.has(o.id) ? "selected" : ""}>${h(o.label)}${fmtVal(o)}</option>`).join("")}</select></label>`).join("")}
    ${opts.filter(o => !o.group).map(o => `<label class="check" style="align-self:end;height:30px"><input type="checkbox" data-pochk="${h(o.id)}" ${sel.has(o.id) ? "checked" : ""}> ${h(o.label)}<small class="muted">${fmtVal(o)}</small></label>`).join("")}
  </div>`;
}

function persoRow(l, p) {
  const t = E.techniques.find(x => x.id === p.techniqueId);
  const uni = lineUni(l);
  const techSelect = `<label class="f"><span>${uni === "print" ? "Produit" : "Technique"}</span><select class="sm" data-pf="techniqueId">${techsOf(uni, p.techniqueId).map(x => `<option value="${h(x.id)}" ${x.id === p.techniqueId ? "selected" : ""}>${h(x.name)}</option>`).join("")}</select></label>`;
  const pu = `<label class="f"><span>PU HT <small class="faint">(forcer)</small></span><div class="input-group"><input type="number" class="sm ${num(p.unitOverride) !== null ? "ov" : ""}" step="0.0001" data-pf="unitOverride" data-pu="${p.id}" value="${h(p.unitOverride ?? "")}"><span class="addon">€</span></div></label>`;
  if (uni === "print") {
    return `<div class="perso" data-perso="${p.id}" style="--pc:${h(t?.color || "#4f46e5")}">
    ${techSelect}
    <label class="f"><span>Format</span><select class="sm" data-pf="formatId">${(t?.formats || []).map(f => `<option value="${h(f.id)}" ${f.id === p.formatId ? "selected" : ""}>${h(f.label)}</option>`).join("")}</select></label>
    <label class="f"><span title="Même nom de fichier sur plusieurs lignes = quantités cumulées">Fichier ⓘ</span><input class="sm" data-pf="design" value="${h(p.design)}" placeholder="Flyer saison"></label>
    ${pu}
    ${optionsUI(t, p)}
    <div class="fmt-hint" data-ph="${p.id}"></div>
  </div>`;
  }
  return `<div class="perso" data-perso="${p.id}" style="--pc:${h(t?.color || "#4f46e5")}">
    ${techSelect}
    <label class="f"><span>Emplacement</span><input class="sm" list="positions" data-pf="position" value="${h(p.position)}" placeholder="${uni === "objet" ? "Face, corps, clip…" : "Cœur, dos…"}"></label>
    <label class="f"><span>Dimensions (cm)</span><div class="dims"><input type="number" class="sm" step="0.5" min="0" data-pf="w" value="${h(p.w ?? "")}" placeholder="L"><span class="muted">×</span><input type="number" class="sm" step="0.5" min="0" data-pf="h" value="${h(p.h ?? "")}" placeholder="H"></div></label>
    <label class="f"><span>Format tarifaire</span><select class="sm" data-pf="formatId"><option value="">Auto</option>${(t?.formats || []).map(f => `<option value="${h(f.id)}" ${f.id === p.formatId ? "selected" : ""}>${h(f.label)}</option>`).join("")}</select></label>
    <label class="f"><span>Couleurs</span><input type="number" class="sm" min="1" max="${t?.maxColors || 12}" data-pf="colors" value="${h(p.colors ?? 1)}" ${t?.colorsEnabled ? "" : "disabled title='Non applicable pour cette technique'"}></label>
    <label class="f"><span title="Même nom de visuel sur plusieurs lignes = quantités cumulées et frais fixes payés une seule fois">Visuel ⓘ</span><input class="sm" data-pf="design" value="${h(p.design)}" placeholder="Logo club"></label>
    ${pu}
    <button class="btn sm ghost icon del" data-pdel title="Retirer">${icon("x", "sm")}</button>
    ${optionsUI(t, p)}
    <div class="fmt-hint" data-ph="${p.id}"></div>
  </div>`;
}

/* -------- Frais annexes -------- */
function drawFees() {
  const q = E.q;
  $("#fees").innerHTML = (q.fees || []).map(f => `<div class="row" style="margin-bottom:8px;flex-wrap:nowrap" data-fee="${f.id}">
    <input type="text" class="sm" data-fe-label value="${h(f.label)}" placeholder="Libellé du frais">
    <input type="number" class="sm" style="width:80px;flex:none" data-fe-qty value="${h(f.qty)}" title="Quantité">
    <span class="muted">×</span>
    <div class="input-group" style="width:120px;flex:none"><input type="number" class="sm" step="0.01" data-fe-unit value="${h(f.unit)}"><span class="addon">€</span></div>
    <b class="num" style="width:90px;text-align:right;flex:none" data-fe-total></b>
    <button class="btn sm ghost icon" data-fe-del>${icon("trash", "sm")}</button></div>`).join("") || `<small class="muted">Aucun frais annexe.</small>`;
  $$("[data-fee]").forEach(row => {
    const f = q.fees.find(x => x.id === row.dataset.fee);
    $("[data-fe-label]", row).oninput = e => { f.label = e.target.value; setDirty(); recalc(); };
    $("[data-fe-qty]", row).oninput = e => { f.qty = num(e.target.value) ?? 0; setDirty(); recalc(); };
    $("[data-fe-unit]", row).oninput = e => { f.unit = num(e.target.value) ?? 0; setDirty(); recalc(); };
    $("[data-fe-del]", row).onclick = () => { q.fees = q.fees.filter(x => x !== f); setDirty(); drawFees(); recalc(); };
  });
}

/* -------- Frais techniques (écrans, digitalisation…) -------- */
function drawSetups(c) {
  const q = E.q;
  const box = $("#setups");
  box.innerHTML = c.setups.length ? c.setups.map(s => `<div class="row" style="margin-bottom:8px;flex-wrap:nowrap">
    <span style="flex:1;min-width:0">${h(s.label)}</span>
    ${s.overridden ? `<button class="btn sm ghost" data-reset="${h(s.key)}" title="Revenir au calcul automatique">${icon("refresh", "sm")}</button>` : ""}
    <div class="input-group" style="width:130px;flex:none"><input type="number" class="sm ${s.overridden ? "ov" : ""}" step="0.01" data-setup="${h(s.key)}" value="${s.overridden ? h(s.amount) : ""}" placeholder="${h(s.computed)}"><span class="addon">€</span></div>
    <button class="btn sm ghost" data-free="${h(s.key)}" title="Offrir ces frais">Offrir</button></div>`).join("")
    : `<small class="muted">Aucun frais technique (ex. : écrans de sérigraphie, digitalisation de broderie).</small>`;
  $$("[data-setup]", box).forEach(i => i.oninput = () => {
    (q.setupOverrides ||= {})[i.dataset.setup] = num(i.value);
    if (num(i.value) === null) delete q.setupOverrides[i.dataset.setup];
    i.classList.toggle("ov", num(i.value) !== null);
    setDirty(); recalc(false);
  });
  $$("[data-free]", box).forEach(b => b.onclick = () => { (q.setupOverrides ||= {})[b.dataset.free] = 0; setDirty(); E.setupKeys = ""; recalc(); });
  $$("[data-reset]", box).forEach(b => b.onclick = () => { delete q.setupOverrides[b.dataset.reset]; setDirty(); E.setupKeys = ""; recalc(); });
}

/* -------- Recalcul en direct -------- */
function recalc(redrawSetups = true) {
  // Compte employé : les prix d'achat ne sont pas dans le navigateur, le serveur calcule
  if (isEmp()) {
    if (!E.c && E.q.computed) applyComputed(E.c = E.q.computed, redrawSetups);
    clearTimeout(E.previewTimer);
    const seq = E.previewSeq = (E.previewSeq || 0) + 1;
    E.previewTimer = setTimeout(async () => {
      try {
        const c = await api("POST", "/quotes/preview", { quote: E.q });
        if (seq === E.previewSeq && E.q) { E.c = c; applyComputed(c, redrawSetups); }
      } catch (e) { fail(e); }
    }, 200);
    return;
  }
  applyComputed(E.c = computeQuote(E.q, E.techniques, S.settings), redrawSetups);
}
function applyComputed(c, redrawSetups = true) {
  const q = E.q;
  const T = c.totals;
  $("#qtyTotal").textContent = `${T.qty} pièce${T.qty > 1 ? "s" : ""} au total`;

  for (const a of c.alternatives || []) {
    const el = $(`[data-alt="${a.id}"]`);
    if (el) el.innerHTML = `Non incluse — <b>${a.deltaHt >= 0 ? "+" : ""}${fmtEUR(a.deltaHt)} HT</b> si le client la retient`;
  }
  for (const l of c.lines) { const el = $(`[data-alt="${l.id}"]`); if (el) el.textContent = l.mode !== "normal" ? "Incluse dans le total" : ""; }
  for (const l of [...c.lines, ...(c.alternatives || []).map(a => a.line).filter(Boolean)]) {
    const src = q.lines.find(x => x.id === l.id);
    const tu = $(`[data-tu="${l.id}"]`);
    if (tu) tu.placeholder = l.textileUnit.toFixed(2);
    const disc = $(`[data-disc="${l.id}"]`);
    if (disc) disc.innerHTML = l.discPct ? `<span class="chip">−${l.discPct} % dès ${(S.settings.textileDiscounts || []).filter(d => l.qty >= d.min).pop()?.min} pcs</span>` : `<small class="faint">—</small>`;
    for (const p of l.persos) {
      const pu = $(`[data-pu="${p.id}"]`);
      if (pu) pu.placeholder = p.computed.toFixed(2);
      const ph = $(`[data-ph="${p.id}"]`);
      if (ph) ph.innerHTML = `<span class="chip">${p.auto ? "Auto : " : ""}${h(p.formatLabel)}</span>
        ${(p.options || []).map(o => `<span class="chip gray">${h(o)}</span>`).join("")}
        <span class="chip" title="Palier de prix appliqué">Palier ${p.breakMin}+ ${l.kind === "print" ? "ex." : "pcs"}${p.breakQty !== l.qty ? ` · cumul ${p.breakQty}` : ""}</span>
        <span class="muted">${fmtEUR(p.unit)} × ${l.qty} = <b>${fmtEUR(p.total)}</b></span>
        ${p.warnings.map(w => `<span class="chip warn">${icon("alert", "sm")} ${h(w)}</span>`).join("")}`;
    }
    const lf = $(`[data-lf="${l.id}"]`);
    const lm = l.total ? Math.round((l.total - l.cost) / l.total * 100) : 0;
    if (lf) lf.innerHTML = `
      <span><span class="k">Qté</span> <span class="v num">${l.qty}</span></span>
      ${src?.supplied ? "" : `<span><span class="k">${l.universe === "objet" ? "Objet" : "Textile"}</span> <span class="num">${fmtEUR(l.textileUnit)}</span></span>`}
      ${l.persos.length ? `<span><span class="k">Marquage</span> <span class="num">${fmtEUR(l.persoUnit)}</span></span>` : ""}
      <span><span class="k">PU HT</span> <span class="v num">${fmtEUR(l.unit)}</span></span>
      ${isEmp() ? "" : `<span title="Marge sur la ligne (hors frais fixes)"><span class="k">Marge</span> <span class="num" style="color:${lm < 25 ? "var(--danger)" : "var(--success)"}">${lm} %</span></span>`}
      <span><span class="k">Total HT</span> <span class="v num" style="font-size:15px">${fmtEUR(l.total)}</span></span>`;
  }
  for (const f of c.fees) {
    const row = $(`[data-fee="${f.id}"] [data-fe-total]`);
    if (row) row.textContent = fmtEUR(f.total);
  }
  const keys = c.setups.map(s => s.key + s.overridden + s.computed + s.label).join("|");
  if (redrawSetups && keys !== E.setupKeys) { E.setupKeys = keys; drawSetups(c); }
  else for (const s of c.setups) { const i = $(`[data-setup="${CSS.escape(s.key)}"]`); if (i) i.placeholder = s.computed; }

  drawSummary(c);
}

function drawSummary(c) {
  const q = E.q, T = c.totals;
  const mp = Math.max(0, Math.min(100, T.marginPct));
  const row = (k, v, cls = "") => `<div class="sum-row ${cls}"><span>${k}</span><span class="num">${v}</span></div>`;
  $("#summary").innerHTML = `<div class="card-h"><h2>Récapitulatif</h2><select class="sm" id="status" style="width:auto">${Object.entries(QUOTE_STATUSES).map(([k, v]) => `<option value="${k}" ${k === q.status ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
  <div class="card-b">
    ${row(c.lines.some(l => l.universe === "objet") ? "Articles (textile & objets)" : "Textile", fmtEUR(T.textile))}
    ${row(c.lines.some(l => l.kind === "print") ? "Marquages & impression" : "Marquages", fmtEUR(T.perso))}
    ${T.setupTotal ? row("Frais techniques", fmtEUR(T.setupTotal)) : ""}
    ${T.feesTotal ? row("Frais annexes", fmtEUR(T.feesTotal)) : ""}
    ${T.discount ? row(`Remise ${T.discountPct} %`, "− " + fmtEUR(T.discount), "sub") : ""}
    ${T.shipping ? row("Port", fmtEUR(T.shipping)) : ""}
    ${row("<b>Total HT</b>", `<b>${fmtEUR(T.ht)}</b>`)}
    ${row(`TVA ${T.vatRate} %`, fmtEUR(T.vat), "sub")}
    ${row("Total TTC", fmtEUR(T.ttc), "total")}
    ${T.deposit ? row(`Acompte ${T.depositPct} %`, fmtEUR(T.deposit), "sub") : ""}
    ${T.qty ? row("Prix moyen / pièce HT", fmtEUR(T.ht / T.qty), "sub") : ""}
    ${isEmp() ? "" : `<div class="margin-box">
      <div class="row between"><b>${icon("lock", "sm")} Marge estimée</b><b class="num" style="color:${T.marginPct < 25 ? "var(--danger)" : "var(--success)"}">${fmtEUR(T.margin)} · ${T.marginPct} %</b></div>
      <div class="margin-bar"><i style="width:${mp}%"></i></div>
      <small class="muted">Coût de revient estimé ${fmtEUR(T.cost)} (textile + % de coût des techniques). Visible uniquement par vous.</small>
    </div>`}
    ${c.warnings.length ? `<div class="warn-list">${c.warnings.map(w => `<div>⚠ ${h(w)}</div>`).join("")}</div>` : ""}
    ${q.production || q.payment?.status ? `<div class="row" style="margin-top:12px;gap:6px">${q.production ? `<a class="chip" href="#/production">${icon("brush", "sm")} ${h(S.settings.productionStages.find(s => s.key === q.production.stage)?.label || "")}</a><a class="chip" href="#/fiche/${q.id}">${icon("print", "sm")} Fiche de fabrication</a>` : ""}${q.payment?.status ? `<a class="chip ${q.payment.status === "paye" ? "green" : ""}" href="#/facturation">${icon("euro", "sm")} ${{ non_paye: "Non payé", acompte: "Acompte reçu", paye: "Payé" }[q.payment.status]}</a>` : ""}</div>` : ""}
    <div class="row" style="margin-top:14px">
      <button class="btn sm" id="dupQ">${icon("copy", "sm")} Dupliquer</button>
      <button class="btn sm" id="tplQ" title="Réutiliser ce devis pour d'autres clients">${icon("save", "sm")} Modèle</button>
      <button class="btn sm" id="shopQ" title="Page de commande pour les membres du club">${icon("card", "sm")} Boutique</button>
      <button class="btn sm" id="refreshQ" title="Réappliquer vos grilles tarifaires actuelles">${icon("refresh", "sm")} Actualiser tarifs</button>
      <button class="btn sm danger" id="delQ">${icon("trash", "sm")}</button>
    </div>
  </div>`;
  $("#status").onchange = e => { q.status = e.target.value; setDirty(); $("#hdrStatus").innerHTML = `${statusBadge(q.status)} ${batBadge(batStatusOf(q))}`; };
  $("#shopQ").onclick = async () => { if (E.dirty && !(await save(true))) return; createShop(() => { location.hash = "#/boutiques"; }, E.q.id); };
  $("#tplQ").onclick = async () => { if (E.dirty && !(await save(true))) return; saveAsTemplate(E.q); };
  $("#dupQ").onclick = async () => {
    if (E.dirty && !(await save(true))) return;
    try { const r = await api("POST", `/quotes/${q.id}/duplicate`); toast("Devis dupliqué"); location.hash = `#/devis/${r.id}`; } catch (e) { fail(e); }
  };
  $("#refreshQ").onclick = async () => {
    if (!(await confirmBox("Actualiser les tarifs ?", "Les prix d'achat, coefficients et grilles de marquage actuels seront réappliqués à ce devis. Vos prix forcés manuellement sont conservés."))) return;
    if (E.dirty && !(await save(true))) return;
    try { load(await api("POST", `/quotes/${q.id}/refresh-pricing`)); drawPage(); toast("Tarifs actualisés"); } catch (e) { fail(e); }
  };
  $("#delQ").onclick = async () => {
    if (!(await confirmBox("Supprimer ce devis ?", `Le devis ${h(q.number)}, ses BAT et l'historique seront définitivement supprimés. Le lien client ne fonctionnera plus.`, { label: "Supprimer", danger: true }))) return;
    try { await api("DELETE", `/quotes/${q.id}`); E.dirty = false; E.q = null; toast("Devis supprimé"); location.hash = "#/devis"; } catch (e) { fail(e); }
  };
}

/* ================================================================
   ENVOI AU CLIENT
   ================================================================ */
function mailto(to, subject, body) {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
async function sendModal() {
  const q = E.q;
  if (!q.lines.length) return fail("Ajoutez au moins un article avant d'envoyer le devis.");
  if (E.dirty && !(await save(true))) return;
  const T = q.computed?.totals || {};
  const co = S.settings.company;
  const tpl = S.settings.templates.quote_sent;
  const subject = renderTpl(tpl.subject, tplVars(q));
  const message = renderTpl(tpl.body, tplVars(q));
  modal({
    title: "Envoyer le devis au client", size: "wide",
    body: `<label class="f"><span>Lien personnel du client</span><div class="input-group"><input type="text" readonly value="${h(q.link)}" id="lnk"><button class="btn" id="cp" style="border-radius:0 8px 8px 0">${icon("copy", "sm")} Copier</button></div>
      <div class="hint">Ce lien secret donne accès au devis, à l'acceptation en ligne, au BAT et à la messagerie.</div></label>
      <div class="grid g2" style="margin-top:14px"><label class="f"><span>Destinataire</span><input type="email" id="to" value="${h(q.client?.email)}"></label>
      <label class="f"><span>Objet</span><input type="text" id="subj" value="${h(subject)}"></label></div>
      <label class="f" style="margin-top:12px"><span>Message</span><textarea id="msg" rows="9">${h(message)}</textarea></label>
      ${S.mailEnabled ? "" : `<p class="hint">${icon("alert", "sm")} SMTP non configuré : « Ouvrir ma messagerie » prépare l'email avec le lien, vous n'avez plus qu'à l'envoyer.</p>`}`,
    actions: [
      { label: "Marquer comme envoyé", onClick: async () => { await api("POST", `/quotes/${q.id}/send`, {}); await afterSend(); } },
      { label: "Ouvrir ma messagerie", icon: "msg", onClick: async m => {
        const msg = $("#msg", m).value;
        location.href = mailto($("#to", m).value, $("#subj", m).value, msg.includes(q.link) ? msg : `${msg}\n\n👉 ${q.link}`);
        await api("POST", `/quotes/${q.id}/send`, {}); await afterSend();
      } },
      ...(S.mailEnabled ? [{ label: "Envoyer l'email", cls: "primary", icon: "send", onClick: async m => {
        await api("POST", `/quotes/${q.id}/send`, { email: true, to: $("#to", m).value, subject: $("#subj", m).value, message: $("#msg", m).value });
        toast("Email envoyé"); await afterSend();
      } }] : []),
    ],
    onOpen: m => { $("#cp", m).onclick = () => { navigator.clipboard.writeText(q.link); toast("Lien copié"); }; },
  });
}
async function afterSend() {
  load(await api("GET", `/quotes/${E.q.id}`));
  drawPage();
  reloadQuotes();
}

/* ================================================================
   ONGLET BAT
   ================================================================ */
function autoSpecs() {
  const c = E.q.computed || E.c;
  if (!c) return "";
  return c.lines.map(l => {
    const sizes = l.sizeRows.map(r => `${r.size}×${r.qty}`).join(", ");
    const opt = p => (p.options || []).length ? ` — ${p.options.join(", ")}` : "";
    if (l.kind === "print") return `${l.name} — ${l.persos.map(p => `${p.formatLabel}${opt(p)}`).join(" / ")} — ${l.qty} exemplaires`;
    const ps = l.persos.map(p => `   • ${p.techniqueName} — ${p.position || "emplacement à préciser"}${p.w && p.h ? ` — ${p.w}×${p.h} cm` : ` — ${p.formatLabel}`}${p.colorsEnabled ? ` — ${p.colors} couleur${p.colors > 1 ? "s" : ""}` : ""}${opt(p)}${p.design ? ` — visuel « ${p.design} »` : ""}`).join("\n");
    return `${l.name}${l.color ? ` — ${l.color}` : ""} (${l.qty} pcs${l.universe === "textile" ? ` : ${sizes}` : ""})${ps ? "\n" + ps : ""}`;
  }).join("\n");
}

function drawBatTab(body) {
  const q = E.q;
  const bats = [...(q.bats || [])].reverse();
  const next = (q.bats || []).length + 1;
  const bs = batStatusOf(q);
  body.innerHTML = `<div class="grid g2" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start">
  <div class="card"><div class="card-h"><h2>Préparer le BAT V${next}</h2>${bs === "modif" ? badge("Modification demandée", "danger") : ""}</div><div class="card-b stack">
    ${E.dirty ? `<div class="warn-list" style="margin:0">Enregistrez le devis avant d'envoyer le BAT.</div>` : ""}
    <div class="drop" id="drop">${icon("upload")}<div style="margin-top:6px"><b>Déposez vos fichiers de BAT</b> (images ou PDF)<br><small>ou cliquez pour parcourir</small></div></div>
    <div class="row"><button class="btn" id="mockBtn">${icon("layers")} Créer une maquette (logo sur le textile)</button></div>
    <div class="bat-files" id="staged"></div>
    <label class="f"><span>Caractéristiques techniques (rappel affiché au client)</span><textarea id="specs" rows="6">${h(autoSpecs())}</textarea></label>
    <label class="f"><span>Message au client</span><textarea id="batMsg" rows="3" placeholder="Ex. : Voici votre BAT, merci de vérifier attentivement l'orthographe et les couleurs."></textarea></label>
    ${S.mailEnabled && q.client?.email ? `<label class="check"><input type="checkbox" id="batMail" checked> Prévenir ${h(q.client.email)} par email</label>` : ""}
    <div class="row end"><button class="btn primary lg" id="sendBat">${icon("send")} Envoyer le BAT V${next} pour validation</button></div>
  </div></div>
  <div class="stack">
    <div class="card"><div class="card-h"><h2>Comment ça marche ?</h2></div><div class="card-b"><ol style="margin:0;padding-left:18px;color:var(--muted)">
      <li>Déposez vos visuels ou créez une maquette, puis envoyez le BAT.</li>
      <li>Le client le consulte via son lien, coche les points de contrôle et <b>signe électroniquement</b>.</li>
      <li>S'il demande une modification, envoyez une nouvelle version : l'historique est conservé.</li>
    </ol></div></div>
    ${bats.length ? bats.map(batCard).join("") : `<div class="card empty"><div class="ico">${icon("image")}</div><b>Aucun BAT envoyé</b><p>Les versions envoyées et les réponses du client apparaîtront ici.</p></div>`}
  </div></div>`;

  const drawStaged = () => {
    $("#staged").innerHTML = E.staged.map((f, i) => `<div class="bat-file">${f.type === "pdf" ? `<a class="pdf" href="${h(f.url)}" target="_blank">${icon("file")}PDF</a>` : `<img src="${h(f.url)}" data-lb="${h(f.url)}">`}
      <button class="btn sm icon x" data-rm="${i}">${icon("x", "sm")}</button><div class="name">${h(f.name)}</div></div>`).join("");
    $$("[data-rm]").forEach(b => b.onclick = () => { E.staged.splice(b.dataset.rm, 1); drawStaged(); });
    $$("[data-lb]").forEach(i => i.onclick = () => lightbox(i.dataset.lb));
  };
  drawStaged();
  bindDrop($("#drop"), async files => {
    for (const f of files) {
      try { toast(`Envoi de ${f.name}…`); E.staged.push(await uploadFile(f)); drawStaged(); } catch (e) { fail(e); }
    }
  }, "image/*,application/pdf");
  $("#mockBtn").onclick = () => mockupTool(file => { E.staged.push(file); drawStaged(); });
  $("#sendBat").onclick = async () => {
    if (E.dirty && !(await save(true))) return;
    if (!E.staged.length) return fail("Ajoutez au moins un fichier ou une maquette.");
    try {
      const r = await api("POST", `/quotes/${q.id}/bats`, { files: E.staged, specs: $("#specs").value, message: $("#batMsg").value, email: $("#batMail")?.checked });
      E.staged = [];
      load(await api("GET", `/quotes/${q.id}`));
      drawPage(); reloadQuotes();
      if (r.mailed) toast("BAT envoyé et client prévenu par email");
      else {
        toast("BAT publié sur l'espace client");
        modal({
          title: "Prévenir le client", body: `<p style="margin-top:0">Le BAT V${r.bat.version} est en ligne. Envoyez le lien à votre client :</p><div class="input-group"><input readonly value="${h(E.q.link)}"><button class="btn" id="cp2" style="border-radius:0 8px 8px 0">${icon("copy", "sm")} Copier</button></div>`,
          actions: [{ label: "Fermer" }, { label: "Ouvrir ma messagerie", cls: "primary", icon: "msg", onClick: () => {
            const t = S.settings.templates.bat_sent, v = tplVars(E.q, { version: r.bat.version });
            location.href = mailto(E.q.client?.email, renderTpl(t.subject, v), renderTpl(t.body, v));
          } }],
          onOpen: m => { $("#cp2", m).onclick = () => { navigator.clipboard.writeText(E.q.link); toast("Lien copié"); }; },
        });
      }
    } catch (e) { fail(e); }
  };
  $$("[data-bat-status]").forEach(s => s.onchange = async () => {
    try { await api("PATCH", `/quotes/${q.id}/bats/${s.dataset.batStatus}`, { status: s.value }); load(await api("GET", `/quotes/${q.id}`)); drawPage(); reloadQuotes(); toast("Statut du BAT mis à jour"); } catch (e) { fail(e); }
  });
  $$("[data-bat-del]").forEach(b => b.onclick = async () => {
    if (!(await confirmBox("Supprimer cette version du BAT ?", "Elle ne sera plus visible par le client.", { danger: true, label: "Supprimer" }))) return;
    try { await api("DELETE", `/quotes/${q.id}/bats/${b.dataset.batDel}`); load(await api("GET", `/quotes/${q.id}`)); drawPage(); } catch (e) { fail(e); }
  });
  $$("[data-lb]", body).forEach(i => i.onclick = () => lightbox(i.dataset.lb));
}

function batCard(b) {
  const st = { en_attente: ["En attente du client", "warning"], valide: ["Validé", "success"], modif: ["Modification demandée", "danger"], remplace: ["Remplacé", "neutral"] }[b.status] || ["—", "neutral"];
  const r = b.response;
  return `<div class="card"><div class="card-h"><h3>BAT V${b.version}</h3>${badge(st[0], st[1])}
    <select class="sm" data-bat-status="${b.id}" style="width:auto" title="Forcer le statut"><option value="">Forcer…</option><option value="en_attente">En attente</option><option value="valide">Validé</option><option value="modif">Modif. demandée</option><option value="remplace">Remplacé</option></select>
    <button class="btn sm ghost icon" data-bat-del="${b.id}">${icon("trash", "sm")}</button></div>
  <div class="card-b stack"><small class="muted">Envoyé le ${fmtDate(b.createdAt, true)}</small>
    <div class="bat-files">${b.files.map(f => `<div class="bat-file">${f.type === "pdf" ? `<a class="pdf" href="${h(f.url)}" target="_blank">${icon("file")}PDF</a>` : `<img src="${h(f.url)}" data-lb="${h(f.url)}">`}<div class="name">${h(f.name)}</div></div>`).join("")}</div>
    ${b.message ? `<div><small class="muted">Message :</small><div style="white-space:pre-wrap">${h(b.message)}</div></div>` : ""}
    ${r ? `<div class="margin-box" style="margin:0;border-style:solid;background:${b.status === "valide" ? "var(--success-50)" : "var(--danger-50)"}">
      <b>${b.status === "valide" ? `✅ Validé par ${h(r.name)}` : `✏️ Modification demandée${r.name ? ` par ${h(r.name)}` : ""}`}</b> <small class="muted">· ${fmtDate(r.at, true)}</small>
      ${r.comment ? `<div style="white-space:pre-wrap;margin-top:6px">${h(r.comment)}</div>` : ""}
      ${r.signature ? `<div style="margin-top:8px"><img class="sig-img" src="${h(r.signature)}" alt="signature"></div>` : ""}
      ${(r.files || []).length ? `<div class="row" style="margin-top:8px">${r.files.map(f => `<a class="chip" href="${h(f.url)}" target="_blank">${icon("file", "sm")} ${h(f.name || "fichier")}</a>`).join("")}</div>` : ""}
    </div>` : ""}
  </div></div>`;
}

/* -------- Créateur de maquette (canvas) -------- */
function loadImg(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible")); i.src = src; });
}
function mockupTool(onDone) {
  const W = 1200;
  const L = { bg: null, items: [], sel: -1 };
  const lineImages = [...new Set(E.q.lines.map(l => l.image).filter(Boolean))];
  const m = modal({
    title: "Créer une maquette de BAT", size: "xwide", dismiss: false,
    body: `<div class="mock-wrap"><canvas class="mock-canvas" id="cv" width="${W}" height="${W}"></canvas>
    <div class="stack">
      <div><div class="section-lbl">Fond (photo du textile)</div><div class="row">
        <button class="btn sm" id="bgUp">${icon("upload", "sm")} Importer</button>
        ${lineImages.map((u, i) => `<button class="thumb" data-bgl="${i}" style="cursor:pointer;padding:0"><img src="${h(u)}"></button>`).join("")}
        <button class="btn sm ghost" id="bgNone">Aucun</button></div></div>
      <div><div class="section-lbl">Ajouter</div><div class="row">
        <button class="btn sm" id="addLogo">${icon("image", "sm")} Logo / visuel</button>
        <button class="btn sm" id="addText">${icon("type", "sm")} Texte / cote</button></div></div>
      <div><div class="section-lbl">Calques</div><div id="layers"></div></div>
      <div id="props"></div>
      <p class="hint">Glissez les éléments pour les placer. Molette ou curseur pour redimensionner.</p>
    </div></div>`,
    actions: [{ label: "Annuler" }, { label: "Ajouter au BAT", cls: "primary", icon: "check", onClick: async () => {
      L.sel = -1; draw();
      const dataUrl = $("#cv", m.el).toDataURL("image/png");
      const r = await api("POST", "/upload", { dataUrl, name: `maquette-${E.q.number}.png` });
      onDone({ ...r, name: `Maquette ${E.q.number}.png` });
      toast("Maquette ajoutée au BAT");
    } }],
  });
  const cv = $("#cv", m.el), ctx = cv.getContext("2d");
  const bbox = it => {
    if (it.type === "img") { const w = it.img.width * it.s, hh = it.img.height * it.s; return { w, h: hh }; }
    ctx.font = `700 ${it.size}px Inter, sans-serif`;
    return { w: ctx.measureText(it.text).width, h: it.size };
  };
  function draw() {
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, W);
    if (L.bg) {
      const k = Math.min(W / L.bg.width, W / L.bg.height);
      ctx.drawImage(L.bg, (W - L.bg.width * k) / 2, (W - L.bg.height * k) / 2, L.bg.width * k, L.bg.height * k);
    }
    L.items.forEach((it, i) => {
      const b = bbox(it);
      ctx.save(); ctx.translate(it.x, it.y); ctx.rotate((it.rot || 0) * Math.PI / 180); ctx.globalAlpha = it.op ?? 1;
      if (it.type === "img") ctx.drawImage(it.img, -b.w / 2, -b.h / 2, b.w, b.h);
      else {
        ctx.font = `700 ${it.size}px Inter, sans-serif`; ctx.fillStyle = it.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(it.text, 0, 0);
      }
      ctx.globalAlpha = 1;
      if (i === L.sel) { ctx.strokeStyle = "#4f46e5"; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.strokeRect(-b.w / 2 - 6, -b.h / 2 - 6, b.w + 12, b.h + 12); }
      ctx.restore();
    });
    drawLayers();
  }
  function drawLayers() {
    $("#layers", m.el).innerHTML = L.items.map((it, i) => `<div class="layer ${i === L.sel ? "on" : ""}" data-ly="${i}">${icon(it.type === "img" ? "image" : "type", "sm")}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(it.type === "img" ? it.name : it.text)}</span><button class="btn sm ghost icon" data-lyd="${i}">${icon("trash", "sm")}</button></div>`).join("") || `<small class="muted">Aucun élément.</small>`;
    $$("[data-ly]", m.el).forEach(el => el.onclick = e => { if (e.target.closest("[data-lyd]")) return; L.sel = +el.dataset.ly; draw(); drawProps(); });
    $$("[data-lyd]", m.el).forEach(b => b.onclick = () => { L.items.splice(+b.dataset.lyd, 1); L.sel = -1; draw(); drawProps(); });
  }
  function drawProps() {
    const it = L.items[L.sel], box = $("#props", m.el);
    if (!it) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="section-lbl">Élément sélectionné</div><div class="stack" style="--g:8px">
      ${it.type === "text" ? `<input type="text" id="pText" value="${h(it.text)}"><div class="row"><input type="color" id="pColor" value="${h(it.color)}" style="width:44px;height:34px;padding:2px">
        <label class="f" style="flex:1"><span>Taille du texte</span><input type="range" id="pSize" min="12" max="260" value="${it.size}" style="width:100%"></label></div>`
        : `<label class="f"><span>Taille</span><input type="range" id="pScale" min="2" max="300" value="${Math.round(it.s * 100)}" style="width:100%"></label>`}
      <label class="f"><span>Rotation</span><input type="range" id="pRot" min="-180" max="180" value="${it.rot || 0}" style="width:100%"></label>
      <label class="f"><span>Opacité</span><input type="range" id="pOp" min="10" max="100" value="${Math.round((it.op ?? 1) * 100)}" style="width:100%"></label>
      <div class="row"><button class="btn sm" id="pCenter">Centrer horizontalement</button><button class="btn sm" id="pFront">Premier plan</button></div></div>`;
    const on = (id, fn) => { const el = $(id, m.el); if (el) el.oninput = () => { fn(el.value); draw(); }; };
    on("#pText", v => it.text = v); on("#pColor", v => it.color = v); on("#pSize", v => it.size = +v);
    on("#pScale", v => it.s = v / 100); on("#pRot", v => it.rot = +v); on("#pOp", v => it.op = v / 100);
    $("#pCenter", m.el).onclick = () => { it.x = W / 2; draw(); };
    $("#pFront", m.el).onclick = () => { L.items.splice(L.sel, 1); L.items.push(it); L.sel = L.items.length - 1; draw(); };
  }
  const setBg = async src => { try { L.bg = src ? await loadImg(src) : null; draw(); } catch (e) { fail(e); } };
  const fileToSrc = async () => {
    const [f] = await pickFiles({ accept: "image/*", multiple: false });
    if (!f) return null;
    const r = await uploadFile(f); // passe par le serveur → image même origine, exportable
    return { src: r.url, name: f.name };
  };
  $("#bgUp", m.el).onclick = async () => { try { const r = await fileToSrc(); if (r) setBg(r.src); } catch (e) { fail(e); } };
  $("#bgNone", m.el).onclick = () => setBg(null);
  $$("[data-bgl]", m.el).forEach(b => b.onclick = () => setBg(lineImages[b.dataset.bgl]));
  $("#addLogo", m.el).onclick = async () => {
    try {
      const r = await fileToSrc(); if (!r) return;
      const img = await loadImg(r.src);
      L.items.push({ type: "img", img, name: r.name, x: W / 2, y: W * 0.4, s: Math.min(1, (W * 0.3) / Math.max(img.width, img.height)), rot: 0 });
      L.sel = L.items.length - 1; draw(); drawProps();
    } catch (e) { fail(e); }
  };
  $("#addText", m.el).onclick = () => {
    L.items.push({ type: "text", text: "10 cm", color: "#e11d48", size: 48, x: W / 2, y: W * 0.8, rot: 0 });
    L.sel = L.items.length - 1; draw(); drawProps();
  };
  // Glisser-déposer
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * W / r.height }; };
  let drag = null;
  cv.onpointerdown = e => {
    const p = pt(e);
    L.sel = -1;
    for (let i = L.items.length - 1; i >= 0; i--) {
      const it = L.items[i], b = bbox(it);
      if (Math.abs(p.x - it.x) <= b.w / 2 + 8 && Math.abs(p.y - it.y) <= b.h / 2 + 8) { L.sel = i; drag = { dx: p.x - it.x, dy: p.y - it.y }; cv.setPointerCapture(e.pointerId); break; }
    }
    draw(); drawProps();
  };
  cv.onpointermove = e => { if (!drag || L.sel < 0) return; const p = pt(e), it = L.items[L.sel]; it.x = p.x - drag.dx; it.y = p.y - drag.dy; draw(); };
  cv.onpointerup = () => { drag = null; };
  cv.onwheel = e => {
    const it = L.items[L.sel]; if (!it) return;
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.05 : 0.95;
    if (it.type === "img") it.s *= k; else it.size = Math.max(8, it.size * k);
    draw(); drawProps();
  };
  if (lineImages[0]) setBg(lineImages[0]); else draw();
}

/* ================================================================
   ONGLET ÉCHANGES & SUIVI
   ================================================================ */
const TL_COLORS = { accept: "#16a34a", bat_ok: "#16a34a", payment: "#16a34a", decline: "#dc2626", bat_ko: "#dc2626", bat: "#d97706", send: "#0284c7", view: "#0284c7", note: "#7c3aed", message: "#4f46e5" };
function drawFollowTab(body) {
  const q = E.q;
  const files = q.files || [];
  const acc = q.acceptance;
  body.innerHTML = `<div class="grid g2" style="align-items:start">
  <div class="stack">
    <div class="row"><button class="btn" id="fMail">${icon("send", "sm")} Écrire un email</button><button class="btn" id="fCall">${icon("clock", "sm")} Noter un appel</button><button class="btn" id="fTask">${icon("check", "sm")} Créer une tâche</button>${q.clientId ? `<a class="btn ghost" href="#/contacts/${q.clientId}">Fiche contact →</a>` : ""}</div>
    <div class="card"><div class="card-h"><h2>Messagerie client</h2><small class="muted">visible sur l'espace client</small></div><div class="card-b">
      <div class="msgs" id="msgs" style="max-height:460px;overflow:auto">${(q.messages || []).map(m => `<div class="msg ${m.from === "atelier" ? "me" : ""}">${h(m.text)}${(m.files || []).map(f => `<div><a href="${h(f.url)}" target="_blank">📎 ${h(f.name || "fichier")}</a></div>`).join("")}<div class="when">${m.from === "atelier" ? "Vous" : h(q.client?.contact || "Client")} · ${fmtDate(m.at, true)}</div></div>`).join("") || `<div class="empty" style="padding:20px">Aucun message pour le moment.</div>`}</div>
      <div style="margin-top:12px"><textarea id="reply" rows="3" placeholder="Écrire au client…"></textarea>
      <div class="row" style="margin-top:8px">${S.mailEnabled && q.client?.email ? `<label class="check"><input type="checkbox" id="replyMail" checked> Prévenir par email</label>` : ""}<span class="spacer"></span><button class="btn primary" id="sendReply">${icon("send", "sm")} Envoyer</button></div></div>
    </div></div>
    ${files.length ? `<div class="card"><div class="card-h"><h2>Fichiers reçus du client</h2></div><div class="card-b"><div class="bat-files">${files.map(f => `<div class="bat-file">${f.type === "pdf" ? `<a class="pdf" href="${h(f.url)}" target="_blank">${icon("file")}PDF</a>` : `<img src="${h(f.url)}" data-lb="${h(f.url)}">`}<div class="name"><a href="${h(f.url)}" download>${h(f.name || "fichier")}</a></div></div>`).join("")}</div></div></div>` : ""}
  </div>
  <div class="stack">
    ${acc ? `<div class="card"><div class="card-h"><h2>Bon pour accord</h2>${badge("Signé", "success")}</div><div class="card-b">
      <div>Accepté par <b>${h(acc.name)}</b> le ${fmtDate(acc.at, true)}${acc.ttc ? ` pour ${fmtEUR(acc.ttc)} TTC` : ""}</div>
      ${acc.comment ? `<div style="margin-top:6px;white-space:pre-wrap">${h(acc.comment)}</div>` : ""}
      <img class="sig-img" style="margin-top:8px" src="${h(acc.signature)}" alt="signature"></div></div>` : ""}
    ${q.depositPayment?.paid ? `<div class="card"><div class="card-b">${icon("card")} Acompte de <b>${fmtEUR(q.depositPayment.amount)}</b> payé en ligne le ${fmtDate(q.depositPayment.at, true)}</div></div>` : ""}
    <div class="card"><div class="card-h"><h2>Historique</h2></div><div class="card-b">
      <div class="row" style="margin-bottom:14px;flex-wrap:nowrap"><input type="text" id="note" placeholder="Ajouter une note interne (appel, relance…)"><button class="btn" id="addNote">${icon("note", "sm")} Noter</button></div>
      <div class="timeline">${[...(q.history || [])].reverse().map(e => `<div class="tl-item" style="--tc:${TL_COLORS[e.type] || "#9aa0b4"}"><div>${e.type === "note" ? `${icon("lock", "sm")} <i>${h(e.text)}</i>` : h(e.text)}</div><div class="when">${fmtDate(e.at, true)}</div></div>`).join("")}</div>
    </div></div>
  </div></div>`;
  const msgs = $("#msgs"); msgs.scrollTop = msgs.scrollHeight;
  const refs = { clientId: q.clientId, quoteId: q.id };
  const refresh = async () => { const r = await api("GET", `/quotes/${q.id}`); syncFollow(r); };
  $("#fMail").onclick = () => emailComposer({ to: q.client?.email, name: q.client?.contact, subject: `Votre devis ${q.number}`, vars: tplVars(q), ...refs }, refresh);
  $("#fCall").onclick = () => activityModal("call", refs, refresh);
  $("#fTask").onclick = () => taskModal({ ...refs, label: q.client?.company || q.client?.contact }, refresh);
  $$("[data-lb]", body).forEach(i => i.onclick = () => lightbox(i.dataset.lb));
  $("#sendReply").onclick = async () => {
    const text = $("#reply").value.trim();
    if (!text) return;
    try { syncFollow(await api("POST", `/quotes/${q.id}/messages`, { text, email: $("#replyMail")?.checked })); toast("Message envoyé"); } catch (e) { fail(e); }
  };
  $("#addNote").onclick = async () => {
    const text = $("#note").value.trim();
    if (!text) return;
    try { syncFollow(await api("POST", `/quotes/${q.id}/messages`, { text, internal: true })); } catch (e) { fail(e); }
  };
}

// ne remplace que le suivi : les modifications non enregistrées du devis sont préservées
function syncFollow(r) {
  Object.assign(E.q, { messages: r.messages, history: r.history, files: r.files });
  drawPage();
}

export { newQuote };
