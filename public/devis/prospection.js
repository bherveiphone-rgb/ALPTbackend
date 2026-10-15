/* Prospection : prospects, recherche dans l'annuaire des entreprises, campagnes d'emails, désinscriptions. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtDate, ago, parseCSV, readAsText, pickFiles, download, toCSV } from "./ui.js";
import { activityModal, taskModal } from "./contacts.js";

const ST = {
  nouveau: ["Nouveau", "neutral"], en_sequence: ["En campagne", "info"], repondu: ["A répondu", "warning"], interesse: ["Intéressé", "success"],
  converti: ["Converti", "success"], sans_reponse: ["Sans réponse", "neutral"], non_interesse: ["Pas intéressé", "neutral"], desinscrit: ["Désinscrit", "danger"], invalide: ["Email invalide", "danger"],
};
const stBadge = s => badge(ST[s]?.[0] || s, ST[s]?.[1] || "neutral");
const P = { tab: "prospects", q: "", status: "", tag: "", sel: new Set(), search: { q: "", naf: "93.12Z", departement: "", code_postal: "", page: 1 } };

export async function renderProspection(main) {
  let state = {};
  try { state = await api("GET", "/prospection/state"); } catch (e) { fail(e); }
  P.naf = state.nafPresets || [];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Prospection</h1><p>Trouvez des structures à équiper, contactez-les par campagnes d'emails personnalisées depuis votre boîte, et suivez les réponses.</p></div></div>
    ${state.mailConfigured ? `<div class="banner t-info">${icon("send")}<div class="grow">Aujourd'hui : <b>${state.sentToday} / ${state.dailyLimit}</b> emails de prospection envoyés · <b>${state.queued}</b> prospect(s) en campagne · ${state.inWindow ? "envoi en cours (1 email toutes les quelques minutes)" : "hors plage d'envoi (reprise automatique)"}.</div>
      <button class="btn sm" id="sendNow">Envoyer le prochain maintenant</button></div>`
      : `<div class="banner t-warning">${icon("alert")}<div class="grow"><b>Connectez votre boîte mail</b> pour envoyer les campagnes : les emails partent de votre adresse, et les réponses arrêtent automatiquement les relances.</div><a class="btn sm" href="#/parametres/emails">Connecter</a></div>`}
    <div class="tabs">${[["prospects", "users", "Prospects"], ["find", "search", "Trouver des prospects"], ["campaigns", "send", "Campagnes"], ["optout", "x", "Désinscrits"]].map(([k, ic, l]) => `<button data-tab="${k}" class="${P.tab === k ? "on" : ""}">${icon(ic, "sm")} ${l}</button>`).join("")}</div>
    <div id="pbody"></div>`;
  $$(".tabs [data-tab]", main).forEach(b => b.onclick = () => { P.tab = b.dataset.tab; renderProspection(main); });
  if ($("#sendNow")) $("#sendNow").onclick = async () => { try { const r = await api("POST", "/prospection/send-now"); toast(r.sent ? "Email envoyé" : "Aucun email en attente d'envoi"); renderProspection(main); } catch (e) { fail(e); } };
  const reload = () => renderProspection(main);
  ({ prospects: tabProspects, find: tabFind, campaigns: tabCampaigns, optout: tabOptout })[P.tab]($("#pbody"), reload);
}

/* -------- Prospects -------- */
async function tabProspects(box, reload) {
  let list = [], seqs = [];
  try { [list, seqs] = await Promise.all([api("GET", "/prospects"), api("GET", "/sequences")]); } catch (e) { fail(e); }
  const tags = [...new Set(list.flatMap(p => p.tags || []))];
  const counts = Object.fromEntries(Object.keys(ST).map(k => [k, list.filter(p => p.status === k).length]));
  box.innerHTML = `<div class="card"><div class="toolbar">
      <div class="search">${icon("search", "sm")}<input type="search" id="ps" placeholder="Structure, ville, email…" value="${h(P.q)}"></div>
      <select id="pst" style="width:170px"><option value="">Tous statuts (${list.length})</option>${Object.entries(ST).map(([k, [l]]) => counts[k] ? `<option value="${k}" ${P.status === k ? "selected" : ""}>${l} (${counts[k]})</option>` : "").join("")}</select>
      <select id="ptg" style="width:150px"><option value="">Tous tags</option>${tags.map(t => `<option ${P.tag === t ? "selected" : ""}>${h(t)}</option>`).join("")}</select>
      <span class="spacer"></span>
      <button class="btn sm" id="pimp">${icon("upload", "sm")} Importer</button><button class="btn sm" id="pexp">${icon("download", "sm")}</button><button class="btn sm primary" id="padd">${icon("plus", "sm")} Ajouter</button>
    </div>
    <div class="toolbar hidden" id="pbulk" style="background:var(--primary-50)"><b id="pn"></b>
      <select class="sm" id="bseq" style="width:220px"><option value="">Inscrire à la campagne…</option>${seqs.map(s => `<option value="${s.id}">${h(s.name)}${s.active ? "" : " (en pause)"}</option>`).join("")}</select>
      <button class="btn sm" id="bstop">Arrêter la campagne</button>
      <select class="sm" id="bst" style="width:170px"><option value="">Changer le statut…</option>${Object.entries(ST).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <button class="btn sm" id="btag">+ Tag</button><button class="btn sm danger" id="bdel">${icon("trash", "sm")}</button></div>
    <div id="pt"></div></div>`;
  const filtered = () => {
    const s = P.q.toLowerCase();
    return list.filter(p => (!P.status || p.status === P.status) && (!P.tag || (p.tags || []).includes(P.tag))
      && (!s || [p.company, p.contact, p.email, p.city, p.zip, p.sector].join(" ").toLowerCase().includes(s))).sort((a, b) => b.score - a.score);
  };
  const bulkBar = () => { $("#pbulk").classList.toggle("hidden", !P.sel.size); $("#pn").textContent = `${P.sel.size} sélectionné(s)`; };
  const draw = () => {
    const rows = filtered();
    $("#pt").innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th style="width:34px"><input type="checkbox" id="pall"></th><th>Structure</th><th>Contact</th><th>Ville</th><th>Score</th><th>Statut</th><th>Campagne</th><th>Dernier envoi</th></tr></thead><tbody>
      ${rows.slice(0, 500).map(p => {
        const seq = seqs.find(s => s.id === p.sequenceId);
        return `<tr class="click" data-p="${p.id}"><td><input type="checkbox" data-sel="${p.id}" ${P.sel.has(p.id) ? "checked" : ""}></td>
        <td><b>${h(p.company || "—")}</b>${(p.tags || []).map(t => ` <span class="tag">${h(t)}</span>`).join("")}<br><small class="muted">${h(p.sector || p.naf || "")}</small></td>
        <td>${h(p.contact || "")}<br><small>${p.email ? h(p.email) : `<span style="color:var(--danger)">email manquant</span>`}</small></td>
        <td><small>${h([p.zip, p.city].filter(Boolean).join(" "))}</small></td>
        <td><span class="score" title="${p.score}/100"><i style="width:${p.score}%"></i></span></td>
        <td>${stBadge(p.status)}</td><td><small>${seq ? `${h(seq.name)}<br>étape ${p.step}/${seq.steps.length}` : "—"}</small></td>
        <td><small>${p.lastSentAt ? ago(p.lastSentAt) : "—"}</small></td></tr>`;
      }).join("")}</tbody></table></div>${rows.length > 500 ? `<p class="hint" style="padding:0 16px">500 premiers affichés — affinez la recherche.</p>` : ""}`
      : `<div class="empty"><div class="ico">${icon("trend")}</div><b>Aucun prospect</b><p>Utilisez l'onglet « Trouver des prospects » (annuaire officiel des entreprises et associations), importez un fichier, ou ajoutez-les un par un.</p></div>`;
    $$("[data-sel]").forEach(c => c.onchange = () => { c.checked ? P.sel.add(c.dataset.sel) : P.sel.delete(c.dataset.sel); bulkBar(); });
    if ($("#pall")) $("#pall").onchange = e => { rows.forEach(p => e.target.checked ? P.sel.add(p.id) : P.sel.delete(p.id)); draw(); bulkBar(); };
    $$("[data-p]").forEach(r => r.onclick = e => { if (!e.target.closest("input")) prospectModal(list.find(p => p.id === r.dataset.p), seqs, reload); });
  };
  const bulk = async body => {
    try { const r = await api("POST", "/prospects/bulk", { ids: [...P.sel], ...body }); toast(`${r.count} prospect(s) mis à jour`); P.sel.clear(); reload(); } catch (e) { fail(e); }
  };
  $("#ps").oninput = e => { P.q = e.target.value; draw(); };
  $("#pst").onchange = e => { P.status = e.target.value; draw(); };
  $("#ptg").onchange = e => { P.tag = e.target.value; draw(); };
  $("#bseq").onchange = async e => {
    const s = seqs.find(x => x.id === e.target.value); if (!s) return;
    if (!(await confirmBox("Inscrire à la campagne ?", `Les prospects sélectionnés ayant un email valide recevront « ${h(s.name)} » (${s.steps.length} email${s.steps.length > 1 ? "s" : ""}).${s.active ? "" : "<br><b>La campagne est en pause</b> : activez-la pour lancer les envois."} Les envois s'arrêtent automatiquement si le prospect répond ou se désinscrit.`, { label: "Inscrire" }))) { e.target.value = ""; return; }
    bulk({ action: "enroll", sequenceId: s.id });
  };
  $("#bstop").onclick = () => bulk({ action: "stop" });
  $("#bst").onchange = e => e.target.value && bulk({ action: "status", status: e.target.value });
  $("#btag").onclick = () => { const t = prompt("Tag à ajouter :"); if (t) bulk({ action: "tag", tag: t }); };
  $("#bdel").onclick = async () => { if (await confirmBox("Supprimer ?", `${P.sel.size} prospect(s) supprimé(s) définitivement.`, { danger: true, label: "Supprimer" })) bulk({ action: "delete" }); };
  $("#padd").onclick = () => prospectModal(null, seqs, reload);
  $("#pimp").onclick = () => importProspects(reload);
  $("#pexp").onclick = () => download(`prospects-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([["structure", "contact", "email", "telephone", "ville", "code_postal", "secteur", "naf", "siren", "statut", "tags"],
    ...list.map(p => [p.company, p.contact, p.email, p.phone, p.city, p.zip, p.sector, p.naf, p.siren, ST[p.status]?.[0], (p.tags || []).join("|")])]), "text/csv");
  draw(); bulkBar();
}

function prospectModal(p, seqs, reload) {
  const isNew = !p;
  p = p || { status: "nouveau", tags: [] };
  const F = [["company", "Structure"], ["contact", "Contact (prénom nom)"], ["email", "Email"], ["phone", "Téléphone"], ["role", "Fonction"], ["website", "Site web"], ["address", "Adresse"], ["zip", "Code postal"], ["city", "Ville"], ["sector", "Secteur"], ["siren", "SIREN"]];
  const google = `https://www.google.com/search?q=${encodeURIComponent(`${p.company || ""} ${p.city || ""} contact email`)}`;
  const seq = seqs.find(s => s.id === p.sequenceId);
  modal({
    title: isNew ? "Nouveau prospect" : p.company || p.email, size: "wide",
    body: `${isNew ? "" : `<div class="row" style="margin-bottom:12px">${stBadge(p.status)}${seq ? `<span class="chip">${h(seq.name)} · étape ${p.step}/${seq.steps.length}${p.nextAt ? ` · prochain envoi ${fmtDate(p.nextAt, true)}` : ""}</span>` : ""}${p.lastError ? `<span class="chip red" title="${h(p.lastError)}">erreur d'envoi</span>` : ""}
        <span class="spacer"></span>${!p.email ? `<a class="btn sm" href="${google}" target="_blank" rel="noopener">${icon("search", "sm")} Trouver l'email</a>` : ""}</div>`}
      <div class="grid g3">${F.map(([k, l]) => `<label class="f"><span>${l}</span><input type="text" data-k="${k}" value="${h(p[k])}"></label>`).join("")}
      <label class="f"><span>Statut</span><select data-k="status">${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <label class="f" style="margin-top:10px"><span>Tags (séparés par des virgules)</span><input type="text" id="ptags" value="${h((p.tags || []).join(", "))}"></label>
      <label class="f" style="margin-top:10px"><span>Notes</span><textarea data-k="notes" rows="3">${h(p.notes)}</textarea></label>`,
    actions: [
      ...(isNew ? [] : [
        { label: "Noter un appel", icon: "clock", onClick: () => { activityModal("call", { prospectId: p.id }, reload); } },
        { label: "Convertir en contact", icon: "users", onClick: async () => { const r = await api("POST", `/prospects/${p.id}/convert`); toast("Prospect ajouté à vos contacts"); location.hash = `#/contacts/${r.clientId}`; } },
      ]),
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async m => {
        const body = Object.fromEntries($$("[data-k]", m).map(i => [i.dataset.k, i.value.trim()]));
        body.tags = $("#ptags", m).value.split(",").map(x => x.trim()).filter(Boolean);
        isNew ? await api("POST", "/prospects", body) : await api("PUT", `/prospects/${p.id}`, body);
        toast("Prospect enregistré"); reload();
      } },
    ],
  });
}

function importProspects(reload) {
  const MAP = { company: ["structure", "societe", "société", "company", "nom", "raison sociale", "club", "entreprise", "organisation"], contact: ["contact", "interlocuteur", "nom complet", "dirigeant"], firstName: ["prenom", "prénom", "first name"],
    email: ["email", "e-mail", "mail", "courriel"], phone: ["telephone", "téléphone", "tel", "phone"], city: ["ville", "city", "commune"], zip: ["code postal", "cp", "zip"], address: ["adresse", "address"],
    sector: ["secteur", "activite", "activité", "sport", "categorie"], website: ["site", "site web", "website", "url"], siren: ["siren", "siret"], naf: ["naf", "ape", "code naf"] };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]/g, " ").trim();
  let items = [];
  const m = modal({
    title: "Importer des prospects", size: "wide",
    body: `<div class="drop" id="dz">${icon("upload")}<div style="margin-top:6px"><b>Déposez un fichier CSV</b> (liste de clubs de la ligue, annuaire, salon, fichier acheté…)</div></div>
      <div class="grid g2" style="margin-top:12px"><label class="f"><span>Tags à appliquer</span><input type="text" id="itags" placeholder="Ex. : Football, Rhône"></label><label class="f"><span>Origine</span><input type="text" id="isrc" placeholder="Ex. : Liste ligue AURA 2026"></label></div>
      <div id="pv" style="margin-top:12px"></div>
      <p class="hint">Les doublons (même email ou SIREN), vos clients existants et les adresses désinscrites sont ignorés automatiquement. Prospection B2B : n'écrivez qu'à des adresses professionnelles et respectez les demandes de désinscription (RGPD).</p>`,
    actions: [{ label: "Annuler" }, { label: "Importer", cls: "primary", onClick: async mm => {
      if (!items.length) throw new Error("Aucune ligne reconnue.");
      const r = await api("POST", "/prospects/import", { items, tags: $("#itags", mm).value.split(",").map(x => x.trim()).filter(Boolean), source: $("#isrc", mm).value });
      toast(`${r.added} ajouté(s), ${r.updated} complété(s), ${r.skipped} ignoré(s)`); reload();
    } }],
  });
  $("#dz", m.el).onclick = async () => {
    const [f] = await pickFiles({ accept: ".csv,text/csv", multiple: false });
    if (!f) return;
    const rows = parseCSV(await readAsText(f));
    const head = rows[0].map(norm);
    const idx = Object.fromEntries(Object.entries(MAP).map(([k, al]) => [k, head.findIndex(x => al.map(norm).includes(x))]));
    items = rows.slice(1).map(r => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, (r[i] || "").trim()])));
    $("#pv", m.el).innerHTML = `<p><b>${items.length}</b> lignes · colonnes reconnues : ${Object.entries(idx).filter(([, i]) => i >= 0).map(([k]) => `<span class="chip">${k}</span>`).join(" ")}</p>`;
  };
}

/* -------- Recherche annuaire -------- */
function tabFind(box, reload) {
  const s = P.search;
  box.innerHTML = `<div class="card"><div class="card-b">
    <p style="margin-top:0" class="muted">Recherche gratuite dans l'annuaire officiel des entreprises et associations (data.gouv.fr) : nom, adresse, activité et dirigeant. Les emails n'y figurent pas — complétez-les ensuite (site web du club, fédération…) avant d'envoyer une campagne.</p>
    <div class="grid g4">
      <label class="f"><span>Activité</span><select id="fnaf"><option value="">— Toutes —</option>${P.naf.map(([c, l]) => `<option value="${c}" ${s.naf === c ? "selected" : ""}>${h(l)} (${c})</option>`).join("")}</select></label>
      <label class="f"><span>Département(s)</span><input type="text" id="fdep" value="${h(s.departement)}" placeholder="69 ou 69,01,42"></label>
      <label class="f"><span>Code postal</span><input type="text" id="fcp" value="${h(s.code_postal)}" placeholder="69003"></label>
      <label class="f"><span>Mot-clé</span><input type="text" id="fq" value="${h(s.q)}" placeholder="football, handball, rugby…"></label>
    </div><div class="row end" style="margin-top:12px"><button class="btn primary" id="fgo">${icon("search")} Rechercher</button></div></div></div>
    <div class="card" style="margin-top:16px" id="fres"></div>`;
  const go = async () => {
    Object.assign(s, { naf: $("#fnaf").value, departement: $("#fdep").value.replace(/\s/g, ""), code_postal: $("#fcp").value.replace(/\s/g, ""), q: $("#fq").value.trim() });
    $("#fres").innerHTML = `<div class="empty">Recherche…</div>`;
    try {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(s).filter(([, v]) => v)));
      const r = await api("GET", `/prospects/search-companies?${qs}`);
      const sel = new Set();
      $("#fres").innerHTML = `<div class="toolbar"><b>${r.total.toLocaleString("fr-FR")} résultat(s)</b><span class="muted">page ${r.page}/${r.totalPages}</span><span class="spacer"></span>
        <input type="text" id="ftags" class="sm" style="width:200px" placeholder="Tags (ex. Foot, Rhône)" value="${h(P.naf.find(([c]) => c === s.naf)?.[1] || "")}">
        <button class="btn sm primary" id="fadd" disabled>${icon("plus", "sm")} Ajouter la sélection</button>
        ${r.page > 1 ? `<button class="btn sm" id="fprev">←</button>` : ""}${r.page < r.totalPages ? `<button class="btn sm" id="fnext">→</button>` : ""}</div>
        <div class="table-wrap"><table class="t"><thead><tr><th style="width:34px"><input type="checkbox" id="fall"></th><th>Structure</th><th>Dirigeant</th><th>Adresse</th><th>Activité</th></tr></thead><tbody>
        ${r.results.map((x, i) => `<tr><td>${x.known ? "✔" : `<input type="checkbox" data-i="${i}">`}</td><td><b>${h(x.company)}</b>${x.known ? ` ${badge("déjà ajouté", "neutral", true)}` : ""}</td>
          <td>${h(x.contact)}<br><small class="muted">${h(x.role)}</small></td><td><small>${h(x.address)}</small></td><td><small>${h(x.naf)}</small></td></tr>`).join("") || `<tr><td colspan="5" class="empty">Aucun résultat.</td></tr>`}</tbody></table></div>`;
      const upd = () => { $("#fadd").disabled = !sel.size; $("#fadd").lastChild.textContent = ` Ajouter la sélection (${sel.size})`; };
      $$("[data-i]").forEach(c => c.onchange = () => { c.checked ? sel.add(+c.dataset.i) : sel.delete(+c.dataset.i); upd(); });
      $("#fall").onchange = e => { $$("[data-i]").forEach(c => { c.checked = e.target.checked; c.onchange(); }); };
      $("#fadd").onclick = async () => {
        const items = [...sel].map(i => r.results[i]).map(x => ({ company: x.company, contact: x.contact, firstName: x.firstName, role: x.role, address: x.address, zip: x.zip, city: x.city, naf: x.naf, siren: x.siren, sector: P.naf.find(([c]) => c === x.naf)?.[1] || "" }));
        try { const res = await api("POST", "/prospects/import", { items, tags: $("#ftags").value.split(",").map(t => t.trim()).filter(Boolean), source: "Annuaire des entreprises" }); toast(`${res.added} prospect(s) ajouté(s)`); go(); } catch (e) { fail(e); }
      };
      if ($("#fprev")) $("#fprev").onclick = () => { s.page--; go(); };
      if ($("#fnext")) $("#fnext").onclick = () => { s.page++; go(); };
    } catch (e) { $("#fres").innerHTML = `<div class="empty">${h(e.message)}</div>`; }
  };
  $("#fgo").onclick = () => { s.page = 1; go(); };
}

/* -------- Campagnes -------- */
async function tabCampaigns(box, reload) {
  let seqs = [];
  try { seqs = await api("GET", "/sequences"); } catch (e) { fail(e); }
  box.innerHTML = `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Une campagne = une suite d'emails espacés de quelques jours. Elle s'arrête dès que le prospect répond, remplit votre formulaire ou se désinscrit. Envois limités à ${S.settings.prospection?.dailyLimit || 40}/jour, en semaine aux heures de bureau, pour préserver votre réputation d'expéditeur.</p>
    <button class="btn primary" id="cnew">${icon("plus")} Nouvelle campagne</button></div>
    <div class="grid g2">${seqs.map(s => `<div class="card"><div class="card-h"><h3>${h(s.name)}</h3>${s.active ? badge("Active", "success") : badge("En pause", "neutral")}</div><div class="card-b">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)"><div><small class="muted">Inscrits</small><b>${s.stats.enrolled}</b></div><div><small class="muted">Emails</small><b>${s.stats.sent}</b></div>
        <div><small class="muted">Réponses</small><b>${s.stats.replied}</b></div><div><small class="muted">Taux</small><b>${s.stats.enrolled ? Math.round(s.stats.replied / s.stats.enrolled * 100) : 0} %</b></div></div>
      <div style="margin-top:10px">${s.steps.map((st, i) => `<div style="font-size:13px">${i + 1}. ${i ? `J+${s.steps.slice(1, i + 1).reduce((x, y) => x + y.delayDays, 0)} · ` : "J0 · "}<b>${h(st.subject)}</b></div>`).join("")}</div>
      <div class="row" style="margin-top:12px"><button class="btn sm" data-ed="${s.id}">${icon("pen", "sm")} Modifier</button><button class="btn sm" data-tg="${s.id}">${s.active ? "Mettre en pause" : "Activer"}</button><button class="btn sm danger" data-dl="${s.id}">${icon("trash", "sm")}</button></div>
    </div></div>`).join("") || `<div class="card empty">Aucune campagne.</div>`}</div>`;
  $("#cnew").onclick = () => sequenceEditor(null, reload);
  $$("[data-ed]").forEach(b => b.onclick = () => sequenceEditor(seqs.find(s => s.id === b.dataset.ed), reload));
  $$("[data-tg]").forEach(b => b.onclick = async () => {
    const s = seqs.find(x => x.id === b.dataset.tg);
    if (!s.active && !S.mailEnabled) return fail("Connectez d'abord votre boîte mail (Paramètres > Emails).");
    try { await api("PUT", `/sequences/${s.id}`, { active: !s.active }); toast(s.active ? "Campagne en pause" : "Campagne activée"); reload(); } catch (e) { fail(e); }
  });
  $$("[data-dl]").forEach(b => b.onclick = async () => { if (await confirmBox("Supprimer la campagne ?", "Les prospects inscrits repassent au statut « Nouveau ».", { danger: true, label: "Supprimer" })) { await api("DELETE", `/sequences/${b.dataset.dl}`); reload(); } });
}

function sequenceEditor(seq, reload) {
  const isNew = !seq;
  const s = seq ? JSON.parse(JSON.stringify(seq)) : { name: "", active: false, steps: [{ delayDays: 0, subject: "", body: "Bonjour {{prenom}},\n\n\n\n{{signature}}" }] };
  const VARS = ["prenom", "contact", "societe", "ville", "atelier", "atelier_contact", "signature", "lien_demande", "site"];
  const m = modal({
    title: isNew ? "Nouvelle campagne" : s.name, size: "xwide",
    body: `<div class="grid g2"><label class="f"><span>Nom de la campagne</span><input type="text" id="sn" value="${h(s.name)}" placeholder="Ex. : Clubs de foot — rentrée"></label>
      <div><div class="section-lbl">Variables (cliquez pour insérer)</div><div class="vars">${VARS.map(v => `<code data-v="${v}">{{${v}}}</code>`).join("")}</div></div></div>
      <div id="steps" style="margin-top:14px"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="sadd">${icon("plus", "sm")} Ajouter une relance</button><span class="spacer"></span>
        ${isNew ? "" : `<input type="email" id="stest" class="sm" style="width:220px" placeholder="Votre email de test"><button class="btn sm" id="sts">Envoyer un test</button>`}</div>
      <p class="hint">Le pied de page avec le lien de désinscription est ajouté automatiquement (modifiable dans Paramètres > Prospection). Astuce : un objet commençant par « Re: » garde les relances dans la même conversation.</p>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async mm => {
      read(); s.name = $("#sn", mm).value.trim();
      if (!s.name) throw new Error("Donnez un nom à la campagne.");
      isNew ? await api("POST", "/sequences", s) : await api("PUT", `/sequences/${seq.id}`, s);
      toast("Campagne enregistrée"); reload();
    } }],
  });
  let lastFocus = null;
  const read = () => $$("[data-st]", m.el).forEach(el => { const i = +el.dataset.st; s.steps[i][el.dataset.f] = el.dataset.f === "delayDays" ? Number(el.value) || 0 : el.value; });
  const draw = () => {
    $("#steps", m.el).innerHTML = s.steps.map((st, i) => `<div class="step-card"><div class="row between"><b>Email ${i + 1}</b>
      <div class="row">${i ? `<span>envoyé</span><input type="number" class="sm" style="width:70px" min="1" data-st="${i}" data-f="delayDays" value="${st.delayDays}"><span>jours après le précédent</span>` : `<span class="muted">envoyé à l'inscription</span>`}
      ${s.steps.length > 1 ? `<button class="btn sm ghost icon" data-rm="${i}">${icon("trash", "sm")}</button>` : ""}</div></div>
      <input type="text" class="sm" style="margin-top:8px" data-st="${i}" data-f="subject" value="${h(st.subject)}" placeholder="Objet">
      <textarea rows="7" style="margin-top:8px" data-st="${i}" data-f="body">${h(st.body)}</textarea></div>`).join("");
    $$("[data-st]", m.el).forEach(el => el.onfocus = () => lastFocus = el);
    $$("[data-rm]", m.el).forEach(b => b.onclick = () => { read(); s.steps.splice(+b.dataset.rm, 1); draw(); });
  };
  $$("[data-v]", m.el).forEach(c => c.onclick = () => {
    const el = lastFocus; if (!el || el.type === "number") return;
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + `{{${c.dataset.v}}}` + el.value.slice(el.selectionEnd ?? pos);
    el.focus();
  });
  $("#sadd", m.el).onclick = () => { read(); s.steps.push({ delayDays: 4, subject: `Re: ${s.steps[0].subject}`, body: "Bonjour {{prenom}},\n\n\n\n{{signature}}" }); draw(); };
  if ($("#sts", m.el)) $("#sts", m.el).onclick = async () => {
    try { await api("POST", `/sequences/${seq.id}/test`, { to: $("#stest", m.el).value }); toast("Email de test envoyé (version enregistrée de la campagne)"); } catch (e) { fail(e); }
  };
  draw();
}

/* -------- Désinscrits -------- */
async function tabOptout(box, reload) {
  let list = [];
  try { list = await api("GET", "/optout"); } catch (e) { fail(e); }
  box.innerHTML = `<div class="card"><div class="toolbar"><p class="muted" style="margin:0;flex:1">Ces adresses ne recevront plus jamais de prospection (désinscription par lien, réponse « STOP » ou ajout manuel).</p>
    <input type="email" id="oe" class="sm" style="width:240px" placeholder="email@exemple.fr"><button class="btn sm" id="oadd">Ajouter</button></div>
    ${list.length ? `<table class="t"><tbody>${list.map(o => `<tr><td>${h(o.email)}</td><td><small class="muted">${h(o.reason || "")}</small></td><td><small>${fmtDate(o.at)}</small></td><td class="r"><button class="btn sm ghost" data-rm="${h(o.email)}">Retirer</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Aucune désinscription.</div>`}</div>`;
  $("#oadd").onclick = async () => { try { await api("POST", "/optout", { email: $("#oe").value }); reload(); } catch (e) { fail(e); } };
  $$("[data-rm]").forEach(b => b.onclick = async () => { if (await confirmBox("Retirer de la liste ?", "Cette personne pourra de nouveau recevoir vos campagnes. Ne le faites qu'avec son accord.", { label: "Retirer" })) { await api("DELETE", `/optout/${encodeURIComponent(b.dataset.rm)}`); reload(); } });
}

export { taskModal };
