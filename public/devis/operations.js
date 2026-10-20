/* Atelier : tableau de production (glisser-déposer), fiche de fabrication imprimable, facturation & Pennylane. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, download, toCSV } from "./ui.js";
import { reloadQuotes } from "./app.js";

const CARRIERS = {
  Colissimo: "https://www.laposte.fr/outils/suivre-vos-envois?code={n}", Chronopost: "https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT={n}",
  "Mondial Relay": "https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition={n}", DPD: "https://trace.dpd.fr/fr/trace/{n}", GLS: "https://gls-group.com/FR/fr/suivi-colis?match={n}",
  UPS: "https://www.ups.com/track?tracknum={n}", "DHL Express": "https://www.dhl.com/fr-fr/home/suivi.html?tracking-id={n}", "Coursier / livraison atelier": "", Autre: "",
};
const PAY = { non_paye: ["Non payé", "danger"], acompte: ["Acompte reçu", "warning"], paye: ["Payé", "success"] };

/* ================================================================
   PRODUCTION
   ================================================================ */
export async function renderProduction(main) {
  let list = [];
  try { list = await api("GET", "/production"); } catch (e) { fail(e); }
  const stages = S.settings.productionStages;
  const recent = Date.now() - 30 * 864e5;
  const stageOf = q => q.production?.stage || "a_lancer";
  const items = list.filter(q => stageOf(q) !== "livre" || (q.production?.deliveredAt || q.updatedAt) > recent);
  const late = items.filter(q => q.deadline && q.deadline < Date.now() && !["expedie", "livre"].includes(stageOf(q)));
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Production</h1><p>Glissez les commandes d'une colonne à l'autre. Le client est prévenu automatiquement au lancement et à l'expédition${S.mailEnabled ? "" : " (dès que votre boîte mail est connectée)"}.</p></div>
    ${late.length ? badge(`${late.length} en retard`, "danger") : ""}</div>
    <div class="kanban" id="kb">${stages.map(s => {
      const cards = items.filter(q => stageOf(q) === s.key).sort((a, b) => (a.deadline || 9e15) - (b.deadline || 9e15));
      return `<div class="kcol" data-stage="${s.key}"><div class="kcol-h">${h(s.label)} <span class="n">${cards.length}</span><span class="sum">${cards.reduce((x, q) => x + (q.totals.qty || 0), 0) || ""}${cards.length ? " pcs" : ""}</span></div>
        ${cards.map(q => prodCard(q, stages)).join("") || `<div class="faint" style="font-size:12px;text-align:center;padding:16px 0">—</div>`}</div>`;
    }).join("")}</div>`;
  // Glisser-déposer
  let dragId = null;
  $$(".kcard[draggable]", main).forEach(c => {
    c.ondragstart = e => { dragId = c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
    c.ondragend = () => { c.classList.remove("dragging"); dragId = null; };
    c.onclick = e => { if (!e.target.closest("select,button,a")) location.hash = `#/devis/${c.dataset.id}`; };
  });
  $$(".kcol", main).forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = e => { e.preventDefault(); col.classList.remove("over"); if (dragId) move(list.find(q => q.id === dragId), col.dataset.stage, () => renderProduction(main)); };
  });
  $$("[data-move]", main).forEach(s => s.onchange = () => { if (s.value) move(list.find(q => q.id === s.dataset.move), s.value, () => renderProduction(main)); });
}

function prodCard(q, stages) {
  const days = q.deadline ? Math.ceil((q.deadline - Date.now()) / 864e5) : null;
  const p = q.production || {};
  return `<div class="kcard" draggable="true" data-id="${q.id}">
    <div class="t"><span>${h(q.client.company || q.client.contact || "—")}</span><span class="num">${q.totals.qty || 0} pcs</span></div>
    <div class="m">${h(q.number)}${q.title ? ` · ${h(q.title)}` : ""}</div>
    <div class="m">${(q.lines || []).slice(0, 3).map(l => `${l.qty}× ${h(l.name)}${l.color ? ` ${h(l.color)}` : ""}`).join("<br>")}${(q.lines || []).length > 3 ? "<br>…" : ""}</div>
    <div class="chips">
      ${days !== null ? `<span class="chip ${days < 0 ? "red" : days <= 3 ? "warn" : "gray"}">${days < 0 ? `retard ${-days} j` : `J-${days}`} · ${fmtDate(q.deadline)}</span>` : ""}
      ${q.batValidated ? `<span class="chip green">BAT ✓</span>` : `<span class="chip red">BAT non validé</span>`}
      <span class="chip ${q.payment?.status === "paye" ? "green" : q.payment?.status === "acompte" || q.depositPaid ? "warn" : "gray"}">${q.payment?.status === "paye" ? "payé" : q.payment?.status === "acompte" || q.depositPaid ? "acompte ✓" : "non payé"}</span>
      ${p.tracking ? `<span class="chip">${h(p.carrier || "suivi")} ${h(p.tracking)}</span>` : ""}
    </div>
    <div class="row" style="margin-top:8px;gap:6px;flex-wrap:nowrap">
      <select class="sm" data-move="${q.id}" style="flex:1"><option value="">Déplacer vers…</option>${stages.filter(s => s.key !== (p.stage || "a_lancer")).map(s => `<option value="${s.key}">${h(s.label)}</option>`).join("")}</select>
      <a class="btn sm" href="#/fiche/${q.id}" title="Fiche de fabrication">${icon("print", "sm")}</a>
    </div></div>`;
}

async function move(q, stage, done) {
  if (!q) return;
  const from = q.production?.stage || "a_lancer";
  if (stage === from) return;
  const autoMail = S.settings.automation?.autoStatusEmails !== false && S.mailEnabled && !!q.client.email;
  if (from === "a_lancer" && stage !== "a_lancer" && !q.batValidated &&
    !(await confirmBox("BAT non validé", "Le client n'a pas encore validé de BAT pour cette commande. Lancer quand même la production ?", { label: "Lancer quand même", danger: true }))) return done();
  const send = async body => {
    try {
      const r = await api("PATCH", `/quotes/${q.id}/production`, { stage, ...body });
      toast(r.mailed?.length ? "Étape mise à jour — client prévenu par email" : "Étape mise à jour");
      reloadQuotes(); done();
    } catch (e) { fail(e); done(); }
  };
  if (stage !== "expedie") return send({ notify: autoMail });
  const p = q.production || {};
  modal({
    title: `${q.number} — expédition / remise`,
    body: `<div class="seg" id="md" style="margin-bottom:12px"><button data-m="expedition" class="${p.mode !== "retrait" ? "on" : ""}">${icon("send", "sm")} Expédition</button><button data-m="retrait" class="${p.mode === "retrait" ? "on" : ""}">${icon("users", "sm")} Retrait à l'atelier</button></div>
      <div id="shipF" class="grid g2"><label class="f"><span>Transporteur</span><select id="car">${Object.keys(CARRIERS).map(c => `<option ${c === p.carrier ? "selected" : ""}>${h(c)}</option>`).join("")}</select></label>
      <label class="f"><span>N° de suivi</span><input type="text" id="trk" value="${h(p.tracking)}"></label></div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="ntf" ${autoMail ? "checked" : ""} ${S.mailEnabled && q.client.email ? "" : "disabled"}> Prévenir ${h(q.client.email || "le client")} par email</label>`,
    actions: [{ label: "Annuler", onClick: () => done() }, { label: "Valider", cls: "primary", icon: "check", onClick: m => {
      const mode = $("#md .on", m).dataset.m, carrier = $("#car", m).value, tracking = $("#trk", m).value.trim();
      const tpl = CARRIERS[carrier] || "";
      send({ mode, carrier: mode === "retrait" ? "" : carrier, tracking: mode === "retrait" ? "" : tracking, trackingUrl: tpl && tracking ? tpl.replace("{n}", encodeURIComponent(tracking)) : "", notify: $("#ntf", m).checked });
    } }],
    onOpen: m => $$("#md button", m).forEach(b => b.onclick = () => { $$("#md button", m).forEach(x => x.classList.toggle("on", x === b)); $("#shipF", m).style.display = b.dataset.m === "retrait" ? "none" : ""; }),
  });
}

/* -------- Fiche de fabrication imprimable -------- */
export async function renderSheet(main, id) {
  let q;
  try { q = await api("GET", `/quotes/${id}`); } catch (e) { main.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  const c = q.computed;
  const bat = [...(q.bats || [])].reverse().find(b => b.status === "valide") || (q.bats || [])[q.bats.length - 1];
  main.innerHTML = `<div class="page-head no-print"><a class="btn icon ghost" href="#/production">${icon("back")}</a><div class="grow"><h1>Fiche de fabrication</h1></div><button class="btn primary" onclick="print()">${icon("print")} Imprimer</button></div>
  <div class="sheet">
    <div class="row between" style="align-items:flex-start"><div><h1 style="font-size:26px">${h(q.number)}</h1><div style="font-size:15px;margin-top:4px"><b>${h(q.client?.company || q.client?.contact || "")}</b>${q.title ? ` — ${h(q.title)}` : ""}</div></div>
      <div style="text-align:right">${q.deadline ? `<div style="font-size:18px;font-weight:800;color:var(--danger)">Pour le ${fmtDate(q.deadline)}</div>` : ""}<div class="muted">Imprimée le ${fmtDate(Date.now(), true)}</div>
      <div>${bat?.status === "valide" ? badge(`BAT V${bat.version} validé`, "success") : badge("BAT NON VALIDÉ", "danger")}</div></div></div>
    <table class="t" style="margin-top:18px"><thead><tr><th>Article</th><th>Couleur</th><th>Tailles</th><th class="r">Total</th><th>Marquages</th></tr></thead><tbody>
    ${c.lines.map(l => `<tr><td><b>${h(l.name)}</b><br><small>${h(l.ref)}</small>${l.supplied && l.kind !== "print" ? `<br>${badge("Textile fourni", "warning")}` : ""}</td><td>${h(l.color)}</td>
      <td>${l.sizeRows.map(r => `<span class="sz">${h(r.size)} : ${r.qty}</span>`).join(" ")}</td><td class="r"><b style="font-size:16px">${l.qty}</b></td>
      <td>${l.persos.map(p => `<div>◆ <b>${h(p.techniqueName)}</b> — ${h(p.position || "?")}${p.w && p.h ? ` — ${p.w}×${p.h} cm` : ` — ${h(p.formatLabel)}`}${p.colorsEnabled ? ` — ${p.colors} coul.` : ""}${(p.options || []).length ? ` — ${p.options.map(h).join(", ")}` : ""}${p.design ? ` — « ${h(p.design)} »` : ""}</div>`).join("")}</td></tr>
      ${l.note ? `<tr><td colspan="5" style="background:#fff8e6"><small>📝 ${h(l.note)}</small></td></tr>` : ""}`).join("")}
    </tbody></table>
    <div class="row" style="margin-top:10px;gap:20px"><div><small class="muted">Total pièces</small><b style="display:block;font-size:20px">${c.totals.qty}</b></div>
      <div><small class="muted">Livraison</small><b style="display:block">${q.production?.mode === "retrait" ? "Retrait atelier" : "Expédition"}</b></div>
      <div><small class="muted">Client</small><b style="display:block">${h(q.client?.contact || "")} ${h(q.client?.phone || "")}</b><small>${h([q.client?.address, q.client?.zip, q.client?.city].filter(Boolean).join(" "))}</small></div></div>
    ${bat ? `<div style="margin-top:18px"><div class="section-lbl">BAT V${bat.version}</div><div class="bat-files" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${bat.files.filter(f => f.type === "image").map(f => `<div class="bat-file"><img src="${h(f.url)}"></div>`).join("")}</div>
      ${bat.specs ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:12.5px">${h(bat.specs)}</pre>` : ""}</div>` : ""}
    ${q.internalNotes ? `<div class="margin-box" style="white-space:pre-wrap"><b>Notes internes :</b>\n${h(q.internalNotes)}</div>` : ""}
    <div class="grid g4" style="margin-top:20px">${["Textile reçu & compté", "Marquage OK", "Contrôle qualité", "Emballé"].map(x => `<div class="margin-box" style="margin:0">☐ ${x}<br><small class="muted">Visa :</small></div>`).join("")}</div>
  </div>`;
}

/* ================================================================
   FACTURATION
   ================================================================ */
let bf = "todo";
export async function renderBilling(main) {
  let list = [];
  try { list = await api("GET", "/billing"); } catch (e) { fail(e); }
  const pl = S.pennylaneEnabled;
  const invoiced = q => (q.invoices || []).filter(i => i.status !== "annulee");
  const toBill = list.filter(q => !invoiced(q).some(i => i.kind !== "acompte"));
  const unpaid = list.filter(q => q.payment?.status !== "paye");
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const paidMonth = list.filter(q => q.payment?.status === "paye" && q.payment.at >= month);
  const filters = { todo: ["À facturer", toBill], unpaid: ["Non soldés", unpaid], all: ["Tous", list] };
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Facturation</h1><p>Factures d'acompte et de solde, suivi des paiements${pl ? " — synchronisé avec Pennylane" : ""}.</p></div>
    ${pl ? `<button class="btn" id="sync">${icon("refresh")} Synchroniser Pennylane</button>` : ""}<button class="btn" id="exp">${icon("download")} Export comptable</button></div>
    ${pl ? "" : `<div class="banner t-info">${icon("link")}<div class="grow"><b>Connectez Pennylane</b> pour créer vos factures en un clic depuis chaque devis (client créé automatiquement, factures en brouillon à valider) et récupérer les paiements.</div><a class="btn sm" href="#/parametres/integrations">Connecter</a></div>`}
    <div class="grid g3 kpis" style="margin-bottom:16px">
      <div class="card kpi"><div class="lbl">À facturer</div><div class="val num">${fmtEUR(toBill.reduce((s, q) => s + (q.totals.ttc || 0), 0))}</div><div class="sub">${toBill.length} commande(s) TTC</div></div>
      <div class="card kpi"><div class="lbl">Reste à encaisser</div><div class="val num">${fmtEUR(unpaid.reduce((s, q) => s + (q.totals.ttc || 0) - (q.payment?.status === "acompte" ? q.totals.deposit || 0 : 0), 0))}</div><div class="sub">${unpaid.length} commande(s) TTC</div></div>
      <div class="card kpi"><div class="lbl">Soldé ce mois</div><div class="val num">${fmtEUR(paidMonth.reduce((s, q) => s + (q.totals.ttc || 0), 0))}</div><div class="sub">${paidMonth.length} commande(s)</div></div>
    </div>
    <div class="card"><div class="toolbar"><div class="seg" id="bs">${Object.entries(filters).map(([k, [l, x]]) => `<button data-f="${k}" class="${bf === k ? "on" : ""}">${l} (${x.length})</button>`).join("")}</div></div><div id="bl"></div></div>`;
  const draw = () => {
    const rows = filters[bf][1];
    $("#bl").innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Devis</th><th>Client</th><th>Statut</th><th class="r">Total TTC</th><th>Paiement</th><th>Factures</th><th></th></tr></thead><tbody>
      ${rows.map(q => `<tr><td><a href="#/devis/${q.id}"><b>${h(q.number)}</b></a><br><small>${fmtDate(q.acceptedAt || q.createdAt)}</small></td><td>${h(q.client.company || q.client.contact)}</td>
        <td>${badge({ accepte: "Accepté", production: "Production", expedie: "Expédié", livre: "Livré" }[q.status] || q.status, "neutral")}</td>
        <td class="r num"><b>${fmtEUR(q.totals.ttc)}</b>${q.totals.deposit ? `<br><small class="muted">acompte ${fmtEUR(q.totals.deposit)}</small>` : ""}</td>
        <td><select class="sm" data-pay="${q.id}" style="width:140px">${Object.entries(PAY).map(([k, [l]]) => `<option value="${k}" ${(q.payment?.status || (q.depositPaid ? "acompte" : "non_paye")) === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td>${(q.invoices || []).map(i => `<div style="font-size:12.5px">${badge(i.kind === "acompte" ? "Acompte" : i.kind === "solde" ? "Solde" : "Facture", i.status === "annulee" ? "neutral" : i.paid ? "success" : i.status === "draft" ? "warning" : "info", true)} ${h(i.number || (i.status === "draft" ? "brouillon" : ""))} ${i.url ? `<a href="${h(i.url)}" target="_blank" rel="noopener">PDF</a>` : ""}${i.status !== "annulee" ? ` <button class="link-btn" data-inv-paid="${q.id}:${i.id}:${i.paid ? 0 : 1}" style="font-size:11.5px">${i.paid ? "non payée" : "payée ✓"}</button>` : ""}</div>`).join("") || `<small class="muted">—</small>`}</td>
        <td class="r" style="white-space:nowrap">${actions(q, pl)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="ico">${icon("euro")}</div>Rien ici pour le moment.</div>`;
    $$("[data-pay]").forEach(s => s.onchange = async () => { try { await api("PATCH", `/quotes/${s.dataset.pay}/payment`, { status: s.value }); toast("Paiement mis à jour"); renderBilling(main); } catch (e) { fail(e); } });
    $$("[data-inv]").forEach(b => b.onclick = async () => {
      const [id, kind] = b.dataset.inv.split(":");
      if (!(await confirmBox("Créer la facture dans Pennylane ?", `Une facture ${kind === "acompte" ? "d'acompte" : kind === "solde" ? "de solde (acompte déduit)" : "complète"} sera créée ${S.settings.pennylane?.draft !== false ? "<b>en brouillon</b> — vous la vérifiez et la finalisez dans Pennylane" : "et <b>finalisée</b>"}. Le client sera créé dans Pennylane s'il n'existe pas.`, { label: "Créer la facture" }))) return;
      b.disabled = true;
      try { await api("POST", `/quotes/${id}/invoice`, { kind }); toast("Facture créée dans Pennylane"); renderBilling(main); } catch (e) { fail(e); b.disabled = false; }
    });
    $$("[data-man]").forEach(b => b.onclick = () => manualInvoice(b.dataset.man, () => renderBilling(main)));
    $$("[data-isync]").forEach(b => b.onclick = async () => { try { const r = await api("POST", `/quotes/${b.dataset.isync}/invoice/sync`); toast(r.changed ? "Factures mises à jour" : "Déjà à jour"); renderBilling(main); } catch (e) { fail(e); } });
    $$("[data-inv-paid]").forEach(b => b.onclick = async () => { const [qid, iid, v] = b.dataset.invPaid.split(":"); try { await api("PATCH", `/quotes/${qid}/invoices/${iid}`, { paid: v === "1" }); renderBilling(main); } catch (e) { fail(e); } });
  };
  $$("#bs button").forEach(b => b.onclick = () => { bf = b.dataset.f; $$("#bs button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  if ($("#sync")) $("#sync").onclick = async () => { try { const r = await api("POST", "/pennylane/sync"); toast(`${r.changed} mise(s) à jour`); renderBilling(main); } catch (e) { fail(e); } };
  $("#exp").onclick = () => download(`facturation-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([
    ["Devis", "Date acceptation", "Client", "Total HT", "TVA", "Total TTC", "Acompte", "Paiement", "Factures"],
    ...list.map(q => [q.number, fmtDate(q.acceptedAt), q.client.company || q.client.contact, q.totals.ht, q.totals.vat, q.totals.ttc, q.totals.deposit, PAY[q.payment?.status || "non_paye"][0], (q.invoices || []).map(i => `${i.kind} ${i.number || ""}`).join(" | ")]),
  ]), "text/csv");
  draw();
}
function actions(q, pl) {
  const inv = (q.invoices || []).filter(i => i.status !== "annulee");
  const has = k => inv.some(i => i.kind === k);
  const out = [];
  if (pl) {
    if (q.totals.deposit && !has("acompte") && !has("total") && !has("solde")) out.push(`<button class="btn sm" data-inv="${q.id}:acompte">Acompte</button>`);
    if (!has("solde") && !has("total")) out.push(`<button class="btn sm primary" data-inv="${q.id}:${has("acompte") ? "solde" : "total"}">${has("acompte") ? "Solde" : "Facturer"}</button>`);
    if (inv.some(i => i.provider === "pennylane")) out.push(`<button class="btn sm ghost icon" data-isync="${q.id}" title="Synchroniser">${icon("refresh", "sm")}</button>`);
  }
  out.push(`<button class="btn sm ghost" data-man="${q.id}" title="Enregistrer une facture faite ailleurs">+ N°</button>`);
  return out.join(" ");
}
function manualInvoice(id, done) {
  modal({
    title: "Enregistrer une facture",
    body: `<div class="grid g2"><label class="f"><span>Type</span><select id="mk"><option value="total">Facture</option><option value="acompte">Acompte</option><option value="solde">Solde</option></select></label>
      <label class="f"><span>Numéro</span><input type="text" id="mn"></label><label class="f"><span>Montant TTC</span><input type="number" step="0.01" id="ma"></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="mp"> Déjà payée</label></div>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async m => {
      await api("POST", `/quotes/${id}/invoice/manual`, { kind: $("#mk", m).value, number: $("#mn", m).value, amountTtc: $("#ma", m).value, paid: $("#mp", m).checked });
      done();
    } }],
  });
}

