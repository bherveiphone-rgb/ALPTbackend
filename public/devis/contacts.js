/* CRM : contacts, fiche contact, demandes de devis, tâches, pipeline, emails. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, ago, num, download, toCSV, parseCSV, readAsText, pickFiles, lightbox } from "./ui.js";
import { reloadQuotes, refreshCounts, newQuote, quotesTable, bindQuoteRows, statusBadge, clientSnapshot, CLIENT_FIELDS, SIGNED } from "./app.js";
import { render as renderTpl } from "./tpl.js";

const TYPES = { client: ["Client", "success"], prospect: ["Prospect", "info"], partenaire: ["Partenaire", "violet"], fournisseur: ["Fournisseur", "neutral"] };
const typeBadge = t => { const x = TYPES[t] || TYPES.client; return badge(x[0], x[1]); };
const initials = c => (c.company || c.contact || c.email || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const dayStart = (d = new Date()) => new Date(d).setHours(0, 0, 0, 0);

/* ================================================================
   CONTACTS
   ================================================================ */
const cf = { q: "", type: "all", tag: "" };
export async function renderContacts(main) {
  let list = [];
  try { list = await api("GET", "/clients"); S.clients = list; } catch (e) { fail(e); }
  const tags = [...new Set([...(S.settings.tags || []), ...list.flatMap(c => c.tags || [])])];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Contacts</h1><p>${list.length} contacts · clients, prospects et partenaires avec tout leur historique.</p></div>
    <button class="btn" id="imp">${icon("upload")} Importer</button><button class="btn" id="exp">${icon("download")} Exporter</button>
    <button class="btn primary" id="add">${icon("plus")} Nouveau contact</button></div>
    <div class="card"><div class="toolbar">
      <div class="search">${icon("search", "sm")}<input type="search" id="cs" placeholder="Nom, email, ville…" value="${h(cf.q)}"></div>
      <div class="seg" id="ct">${[["all", "Tous"], ["client", "Clients"], ["prospect", "Prospects"], ["partenaire", "Partenaires"]].map(([k, l]) => `<button data-t="${k}" class="${cf.type === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select id="tg" style="width:170px"><option value="">Tous les tags</option>${tags.map(t => `<option ${cf.tag === t ? "selected" : ""}>${h(t)}</option>`).join("")}</select>
    </div><div id="tbl"></div></div>`;
  const draw = () => {
    const s = cf.q.toLowerCase();
    const rows = list.filter(c => (cf.type === "all" || (c.type || "client") === cf.type) && (!cf.tag || (c.tags || []).includes(cf.tag))
      && (!s || [c.company, c.contact, c.email, c.city, c.phone, ...(c.tags || [])].join(" ").toLowerCase().includes(s)))
      .sort((a, b) => (b.stats.ca - a.stats.ca) || ((b.lastContactAt || b.createdAt || 0) - (a.lastContactAt || a.createdAt || 0)));
    $("#tbl").innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Contact</th><th>Type</th><th>Coordonnées</th><th class="r">Devis</th><th class="r">CA signé HT</th><th>Dernier échange</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr class="click" data-c="${c.id}"><td><div class="row" style="flex-wrap:nowrap;gap:10px"><div class="avatar" style="width:34px;height:34px;font-size:12px;border-radius:10px">${h(initials(c))}</div><div><b>${h(c.company || c.contact || c.email)}</b><br><small>${h(c.company ? c.contact : "")}${(c.tags || []).map(t => ` <span class="tag">${h(t)}</span>`).join("")}</small></div></div></td>
        <td>${typeBadge(c.type)}</td><td><small>${h(c.email)}<br>${h(c.phone)}${c.city ? ` · ${h(c.city)}` : ""}</small></td>
        <td class="r">${c.stats.quotes}${c.stats.conversion !== null ? `<br><small class="muted">${c.stats.conversion} % signés</small>` : ""}</td>
        <td class="r num"><b>${fmtEUR(c.stats.ca)}</b></td><td><small>${c.lastContactAt ? ago(c.lastContactAt) : "—"}</small>${c.openTasks ? ` ${badge(c.openTasks + " tâche" + (c.openTasks > 1 ? "s" : ""), "info", true)}` : ""}</td>
        <td class="r"><button class="btn sm" data-nq="${c.id}">${icon("plus", "sm")} Devis</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="ico">${icon("users")}</div><b>Aucun contact</b><p>Les contacts sont créés automatiquement à chaque demande ou devis accepté. Vous pouvez aussi importer votre fichier clients.</p></div>`;
    $$("[data-c]").forEach(r => r.onclick = e => { if (!e.target.closest("[data-nq]")) location.hash = `#/contacts/${r.dataset.c}`; });
    $$("[data-nq]").forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.nq); newQuote({ clientId: c.id, client: clientSnapshot(c), discountPct: c.discountPct || 0 }); });
  };
  $("#cs").oninput = e => { cf.q = e.target.value; draw(); };
  $$("#ct button").forEach(b => b.onclick = () => { cf.type = b.dataset.t; $$("#ct button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  $("#tg").onchange = e => { cf.tag = e.target.value; draw(); };
  $("#add").onclick = () => clientModal(null, c => c && (location.hash = `#/contacts/${c.id}`));
  $("#exp").onclick = () => download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([
    ["societe", "contact", "email", "telephone", "adresse", "code_postal", "ville", "type", "tags", "remise", "nb_devis", "ca_signe_ht", "source"],
    ...list.map(c => [c.company, c.contact, c.email, c.phone, c.address, c.zip, c.city, c.type, (c.tags || []).join("|"), c.discountPct || 0, c.stats.quotes, c.stats.ca, c.source]),
  ]), "text/csv");
  $("#imp").onclick = () => importContacts(() => renderContacts(main));
  draw();
}

function importContacts(onDone) {
  const MAP = { company: ["societe", "société", "company", "structure", "club", "raison sociale", "entreprise", "organisation"], contact: ["contact", "nom", "name", "nom complet", "interlocuteur"],
    email: ["email", "e-mail", "mail", "courriel"], phone: ["telephone", "téléphone", "tel", "phone", "portable", "mobile"], address: ["adresse", "address", "rue"],
    zip: ["code postal", "code_postal", "cp", "zip"], city: ["ville", "city", "commune"], tags: ["tags", "etiquettes", "catégorie", "categorie"], type: ["type"] };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]/g, " ").trim();
  let items = [];
  const m = modal({
    title: "Importer des contacts", size: "wide",
    body: `<div class="drop" id="dz">${icon("upload")}<div style="margin-top:6px"><b>Déposez un fichier CSV</b> (export Excel, Google Contacts, ancien logiciel…)<br><small>colonnes reconnues : société, contact, email, téléphone, adresse, code postal, ville, tags</small></div></div><div id="pv" style="margin-top:12px"></div>`,
    actions: [{ label: "Annuler" }, { label: "Importer", cls: "primary", onClick: async () => {
      if (!items.length) throw new Error("Aucune ligne reconnue.");
      const r = await api("POST", "/clients/import", { items });
      toast(`${r.added} contact(s) ajouté(s), ${r.updated} mis à jour`); onDone?.();
    } }],
  });
  const load = text => {
    const rows = parseCSV(text);
    const head = rows[0].map(norm);
    const idx = Object.fromEntries(Object.entries(MAP).map(([k, al]) => [k, head.findIndex(x => al.map(norm).includes(x))]));
    items = rows.slice(1).map(r => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, k === "tags" ? String(r[i] || "").split(/[|,;]/).map(x => x.trim()).filter(Boolean) : (r[i] || "").trim()])));
    $("#pv", m.el).innerHTML = `<p><b>${items.length}</b> lignes · colonnes reconnues : ${Object.entries(idx).filter(([, i]) => i >= 0).map(([k]) => `<span class="chip">${k}</span>`).join(" ") || "aucune"}</p>`;
  };
  $("#dz", m.el).onclick = async () => { const [f] = await pickFiles({ accept: ".csv,text/csv", multiple: false }); if (f) load(await readAsText(f)); };
}

export function clientModal(c, onSaved) {
  const isNew = !c;
  c = c || { type: "client", tags: [] };
  const tags = [...new Set([...(S.settings.tags || []), ...(c.tags || [])])];
  modal({
    title: isNew ? "Nouveau contact" : c.company || c.contact || "Contact", size: "wide",
    body: `<div class="grid g3">${CLIENT_FIELDS.map(([k, l, t]) => `<label class="f"><span>${l}</span><input type="${t || "text"}" name="${k}" value="${h(c[k])}"></label>`).join("")}
      <label class="f"><span>Type</span><select name="type">${Object.entries(TYPES).map(([k, [l]]) => `<option value="${k}" ${(c.type || "client") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f"><span>Site web</span><input type="url" name="website" value="${h(c.website)}"></label>
      <label class="f"><span>Remise habituelle</span><div class="input-group"><input type="number" name="discountPct" step="0.5" min="0" max="100" value="${h(c.discountPct ?? "")}"><span class="addon">%</span></div></label>
      <label class="f"><span>Origine</span><input type="text" name="source" value="${h(c.source)}" placeholder="Bouche-à-oreille, salon, site…"></label>
      <label class="f"><span>Secteur</span><input type="text" name="sector" value="${h(c.sector)}" placeholder="Football, BTP, école…"></label>
      </div>
      <div style="margin-top:12px"><div class="section-lbl">Tags</div><div class="row" style="gap:6px">${tags.map(t => `<label class="check"><input type="checkbox" data-tag="${h(t)}" ${(c.tags || []).includes(t) ? "checked" : ""}> ${h(t)}</label>`).join("")}
        <input type="text" id="newTag" class="sm" style="width:150px" placeholder="+ nouveau tag"></div></div>
      <label class="f" style="margin-top:12px"><span>Notes internes</span><textarea name="notes">${h(c.notes)}</textarea></label>`,
    actions: [
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async m => {
        const data = Object.fromEntries($$("[name]", m).map(i => [i.name, i.type === "number" ? num(i.value) ?? 0 : i.value.trim()]));
        data.tags = [...$$("[data-tag]", m).filter(i => i.checked).map(i => i.dataset.tag), ...($("#newTag", m).value.trim() ? [$("#newTag", m).value.trim()] : [])];
        if (!data.company && !data.contact && !data.email) throw new Error("Indiquez au moins une société, un contact ou un email.");
        const saved = isNew ? await api("POST", "/clients", data) : await api("PUT", `/clients/${c.id}`, data);
        S.clients = isNew ? [...S.clients, saved] : S.clients.map(x => x.id === saved.id ? saved : x);
        toast("Contact enregistré");
        onSaved?.(saved);
      } },
    ],
  });
}

/* -------- Fiche contact -------- */
const TL_ICONS = {
  email_out: ["send", "info"], email_in: ["msg", "warning"], call: ["clock", "violet"], meeting: ["users", "violet"], note: ["note", "neutral"], visit: ["users", "violet"],
  request: ["msg", "warning"], won: ["check", "success"], lost: ["x", "danger"], task_done: ["check", "success"], review: ["sparkle", "warning"], message_in: ["msg", "warning"], system: ["refresh", "neutral"],
};
const tlIcon = t => TL_ICONS[t] || (t.startsWith("quote_") ? ["file", "neutral"] : ["refresh", "neutral"]);

export async function renderContact(main, id) {
  main.innerHTML = `<div class="empty">Chargement…</div>`;
  let d;
  try { d = await api("GET", `/clients/${id}`); } catch (e) { main.innerHTML = `<div class="empty">${h(e.message)} — <a href="#/contacts">retour</a></div>`; return; }
  const c = d.client, st = d.stats;
  const refs = { clientId: c.id };
  main.innerHTML = `<div class="page-head">
    <a class="btn icon ghost" href="#/contacts">${icon("back")}</a>
    <div class="avatar">${h(initials(c))}</div>
    <div class="grow"><div class="row" style="gap:8px"><h1>${h(c.company || c.contact || c.email)}</h1>${typeBadge(c.type)}${(c.tags || []).map(t => `<span class="tag">${h(t)}</span>`).join("")}${d.optedOut ? badge("Désinscrit prospection", "danger") : ""}</div>
      <p>${h([c.company && c.contact, c.city].filter(Boolean).join(" · "))}${c.source ? ` · origine : ${h(c.source)}` : ""} · client depuis ${fmtDate(c.createdAt)}</p></div>
    <button class="btn" id="mail">${icon("send")} Email</button>
    <button class="btn" id="log">${icon("note")} Noter un échange</button>
    <button class="btn" id="task">${icon("check")} Tâche</button>
    <button class="btn primary" id="nq">${icon("plus")} Nouveau devis</button>
  </div>
  <div class="profile">
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Coordonnées</h3><button class="btn sm ghost" id="edit">${icon("pen", "sm")} Modifier</button></div><div class="card-b">
        <dl class="kv">
          ${c.contact ? `<dt>Contact</dt><dd>${h(c.contact)}</dd>` : ""}
          ${c.email ? `<dt>Email</dt><dd><a href="mailto:${h(c.email)}">${h(c.email)}</a></dd>` : ""}
          ${c.phone ? `<dt>Téléphone</dt><dd><a href="tel:${h(c.phone)}">${h(c.phone)}</a></dd>` : ""}
          ${c.address || c.city ? `<dt>Adresse</dt><dd>${h(c.address)}<br>${h([c.zip, c.city].filter(Boolean).join(" "))}</dd>` : ""}
          ${c.website ? `<dt>Site</dt><dd><a href="${h(/^https?:/.test(c.website) ? c.website : "https://" + c.website)}" target="_blank" rel="noopener">${h(c.website)}</a></dd>` : ""}
          ${c.vatNumber || c.siret ? `<dt>TVA / SIRET</dt><dd>${h(c.vatNumber || c.siret)}</dd>` : ""}
          ${c.sector ? `<dt>Secteur</dt><dd>${h(c.sector)}</dd>` : ""}
          <dt>Remise</dt><dd>${c.discountPct ? `${c.discountPct} %` : "—"}</dd>
          <dt>Pennylane</dt><dd>${c.pennylaneId ? badge("Synchronisé", "success") : `<small class="muted">créé à la 1re facture</small>`}</dd>
        </dl>
        ${c.notes ? `<div class="margin-box" style="white-space:pre-wrap;font-size:13px">${h(c.notes)}</div>` : ""}
      </div></div>
      <div class="card"><div class="card-h"><h3>Chiffres clés</h3></div><div class="card-b"><div class="stat-grid">
        <div><small class="muted">CA signé HT</small><b>${fmtEUR(st.ca)}</b></div>
        <div><small class="muted">Devis signés</small><b>${st.signed} / ${st.quotes}</b></div>
        <div><small class="muted">Panier moyen</small><b>${fmtEUR(st.avgBasket)}</b></div>
        <div><small class="muted">Transformation</small><b>${st.conversion ?? "—"}${st.conversion !== null ? " %" : ""}</b></div>
        <div><small class="muted">En attente</small><b>${fmtEUR(st.pending)}</b></div>
        <div><small class="muted">Satisfaction</small><b>${st.rating ? `${st.rating} / 5 ★` : "—"}</b></div>
      </div>${st.lastOrderAt ? `<p class="hint">Dernière commande : ${fmtDate(st.lastOrderAt)}</p>` : ""}</div></div>
      <div class="card"><div class="card-h"><h3>Tâches</h3><button class="btn sm ghost" id="task2">${icon("plus", "sm")}</button></div><div id="ctasks">${d.tasks.filter(t => !t.done).map(taskRow).join("") || `<div class="card-b"><small class="muted">Aucune tâche en cours.</small></div>`}</div></div>
      <div class="row"><button class="btn sm" id="merge">${icon("users", "sm")} Fusionner un doublon</button><button class="btn sm danger" id="del">${icon("trash", "sm")} Supprimer</button></div>
    </div>
    <div class="stack">
      <div class="tabs" style="margin-bottom:0">
        <button data-tab="tl" class="on">${icon("clock", "sm")} Historique <span class="count">${d.timeline.length}</span></button>
        <button data-tab="q">${icon("file", "sm")} Devis <span class="count">${d.quotes.length}</span></button>
        <button data-tab="r">${icon("msg", "sm")} Demandes <span class="count">${d.requests.length}</span></button>
      </div>
      <div class="card" id="ctab"></div>
    </div>
  </div>`;
  const tabs = {
    tl: () => `<div class="card-b"><div class="row" style="margin-bottom:6px">${["note", "call", "meeting"].map(t => `<button class="btn sm" data-quick="${t}">${icon(t === "note" ? "note" : t === "call" ? "clock" : "users", "sm")} ${{ note: "Note", call: "Appel", meeting: "Rendez-vous" }[t]}</button>`).join("")}</div>
      <div class="tl2">${d.timeline.map(ev => {
        const [ic, tone] = tlIcon(ev.type);
        const link = ev.quoteId ? `<a href="#/devis/${ev.quoteId}">${h(ev.number || "devis")}</a> · ` : ev.requestId ? `<a href="#/demandes/${ev.requestId}">demande</a> · ` : "";
        return `<div class="ev"><div class="ic t-${tone}">${icon(ic, "sm")}</div><div class="body"><div>${ev.type === "note" ? `<i>${h(ev.text)}</i>` : h(ev.text)}</div>
          ${ev.body ? `<details><summary>Voir le message</summary><pre>${h(ev.body)}</pre></details>` : ""}<small class="muted">${link}${{ call: "Appel", meeting: "Rendez-vous", note: "Note", email_in: "Email reçu", email_out: "Email envoyé" }[ev.type] || ""}</small></div>
          <div class="when">${fmtDate(ev.at, true)}</div></div>`;
      }).join("") || `<div class="empty">Aucun échange enregistré.</div>`}</div></div>`,
    q: () => quotesTable(d.quotes, { compact: true }),
    r: () => d.requests.length ? `<table class="t"><tbody>${d.requests.map(r => `<tr class="click" data-r="${r.id}"><td><b>${h(r.number)}</b></td><td>${h(r.subject || r.items.map(i => i.product).join(", "))}</td><td>${reqBadge(r.status)}</td><td><small>${fmtDate(r.createdAt)}</small></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Aucune demande.</div>`,
  };
  const show = k => {
    $$(".tabs [data-tab]", main).forEach(b => b.classList.toggle("on", b.dataset.tab === k));
    $("#ctab").innerHTML = tabs[k]();
    bindQuoteRows($("#ctab"));
    $$("[data-r]", main).forEach(r => r.onclick = () => location.hash = `#/demandes/${r.dataset.r}`);
    $$("[data-quick]", main).forEach(b => b.onclick = () => activityModal(b.dataset.quick, refs, () => renderContact(main, id)));
  };
  $$(".tabs [data-tab]", main).forEach(b => b.onclick = () => show(b.dataset.tab));
  show("tl");
  const reload = () => renderContact(main, id);
  bindTaskRows($("#ctasks"), reload);
  $("#edit").onclick = () => clientModal(c, reload);
  $("#nq").onclick = () => newQuote({ clientId: c.id, client: clientSnapshot(c), discountPct: c.discountPct || 0 });
  $("#mail").onclick = () => emailComposer({ to: c.email, name: c.contact, ...refs }, reload);
  $("#log").onclick = () => activityModal("call", refs, reload);
  $("#task").onclick = $("#task2").onclick = () => taskModal({ ...refs, label: c.company || c.contact }, reload);
  $("#del").onclick = async () => {
    if (!(await confirmBox("Supprimer ce contact ?", "Ses devis sont conservés mais ne seront plus rattachés à une fiche.", { danger: true, label: "Supprimer" }))) return;
    try { await api("DELETE", `/clients/${c.id}`); toast("Contact supprimé"); location.hash = "#/contacts"; } catch (e) { fail(e); }
  };
  $("#merge").onclick = () => {
    const others = S.clients.filter(x => x.id !== c.id);
    modal({
      title: "Fusionner un doublon", body: `<p style="margin-top:0">Le contact choisi sera fusionné dans « ${h(c.company || c.contact)} » : devis, demandes, historique et tâches sont regroupés.</p>
        <select id="mo">${others.map(o => `<option value="${o.id}">${h(o.company || o.contact)} — ${h(o.email)}</option>`).join("")}</select>`,
      actions: [{ label: "Annuler" }, { label: "Fusionner", cls: "primary", onClick: async m => { await api("POST", `/clients/${c.id}/merge`, { otherId: $("#mo", m).value }); toast("Contacts fusionnés"); reload(); } }],
    });
  };
}

/* -------- Saisie d'activité, email, tâche -------- */
export function activityModal(type, refs, onSaved) {
  const labels = { call: "Appel", meeting: "Rendez-vous", note: "Note", visit: "Visite" };
  modal({
    title: "Noter un échange",
    body: `<div class="seg" id="at" style="margin-bottom:12px">${Object.entries(labels).map(([k, l]) => `<button data-k="${k}" class="${k === type ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="f"><span>Compte rendu</span><textarea id="atx" rows="5" placeholder="Ce qui a été dit, décidé, la suite…"></textarea></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="afu"> Créer une tâche de suivi dans <input type="number" id="afd" value="3" class="sm" style="width:60px"> jours</label>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async m => {
      const t = $("#at .on", m).dataset.k, text = $("#atx", m).value.trim();
      if (!text) throw new Error("Écrivez un compte rendu.");
      await api("POST", "/activities", { type: t, text, ...refs });
      if ($("#afu", m).checked) await api("POST", "/tasks", { title: `Suivi : ${text.slice(0, 80)}`, due: dayStart() + (num($("#afd", m).value) || 3) * 864e5 + 9 * 36e5, ...refs });
      toast("Échange enregistré"); onSaved?.();
    } }],
    onOpen: m => $$("#at button", m).forEach(b => b.onclick = () => $$("#at button", m).forEach(x => x.classList.toggle("on", x === b))),
  });
}

/** Rédaction d'un email (modèles disponibles). Passe par la boîte connectée, sinon ouvre la messagerie. */
export function emailComposer({ to = "", name = "", subject = "", text = "", vars = {}, ...refs }, onSent) {
  const tpls = Object.entries(S.settings.templates || {});
  modal({
    title: "Écrire un email", size: "wide",
    body: `<div class="grid g2"><label class="f"><span>À</span><input type="email" id="eto" value="${h(to)}"></label>
      <label class="f"><span>Modèle</span><select id="etp"><option value="">— Message libre —</option>${tpls.map(([k, t]) => `<option value="${k}">${h(t.label)}</option>`).join("")}</select></label></div>
      <label class="f" style="margin-top:10px"><span>Objet</span><input type="text" id="esu" value="${h(subject)}"></label>
      <label class="f" style="margin-top:10px"><span>Message</span><textarea id="etx" rows="11">${h(text || `Bonjour ${name || ""},\n\n\n\n${S.settings.emailSignature || S.settings.company.name || ""}`)}</textarea></label>
      ${S.mailEnabled ? "" : `<p class="hint">${icon("alert", "sm")} Boîte mail non connectée : votre messagerie s'ouvrira avec le message prêt, et l'échange sera noté dans l'historique.</p>`}`,
    actions: [{ label: "Annuler" }, { label: S.mailEnabled ? "Envoyer" : "Ouvrir ma messagerie", cls: "primary", icon: "send", onClick: async m => {
      const payload = { to: $("#eto", m).value.trim(), subject: $("#esu", m).value.trim(), text: $("#etx", m).value, ...refs };
      if (!payload.to) throw new Error("Destinataire manquant");
      if (S.mailEnabled) { await api("POST", "/emails/send", payload); toast("Email envoyé"); }
      else {
        location.href = `mailto:${encodeURIComponent(payload.to)}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.text)}`;
        await api("POST", "/activities", { type: "email_out", text: `Email « ${payload.subject} » à ${payload.to}`, ...refs });
      }
      onSent?.();
    } }],
    onOpen: m => {
      $("#etp", m).onchange = e => {
        const t = S.settings.templates[e.target.value];
        if (!t) return;
        const v = { contact: name, atelier: S.settings.company.name, signature: S.settings.emailSignature || S.settings.company.name, ...vars };
        $("#esu", m).value = renderTpl(t.subject, v);
        $("#etx", m).value = renderTpl(t.body, v);
      };
    },
  });
}

export function taskModal({ label = "", ...refs } = {}, onSaved, task = null) {
  const due = task ? new Date(task.due) : new Date(Date.now() + 864e5);
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  modal({
    title: task ? "Modifier la tâche" : "Nouvelle tâche",
    body: `<label class="f"><span>À faire</span><input type="text" id="tt" value="${h(task?.title || "")}" placeholder="${label ? `Ex. : Rappeler ${h(label)}` : "Ex. : Commander les textiles"}"></label>
      <div class="grid g2" style="margin-top:10px"><label class="f"><span>Échéance</span><input type="datetime-local" id="td" value="${iso(due)}"></label>
      <label class="f"><span>Priorité</span><select id="tp"><option value="normal">Normale</option><option value="high" ${task?.priority === "high" ? "selected" : ""}>Haute</option></select></label></div>
      <div class="row" style="margin-top:10px">${[["Aujourd'hui", 0], ["Demain", 1], ["Dans 3 j", 3], ["Dans 1 sem.", 7]].map(([l, d]) => `<button class="btn sm" data-d="${d}">${l}</button>`).join("")}</div>
      <label class="f" style="margin-top:10px"><span>Notes</span><textarea id="tn" rows="2">${h(task?.notes || "")}</textarea></label>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async m => {
      const body = { title: $("#tt", m).value.trim(), due: new Date($("#td", m).value).getTime() || Date.now(), priority: $("#tp", m).value, notes: $("#tn", m).value, ...refs };
      if (!body.title) throw new Error("Décrivez la tâche.");
      task ? await api("PUT", `/tasks/${task.id}`, body) : await api("POST", "/tasks", body);
      toast("Tâche enregistrée"); refreshCounts(); onSaved?.();
    } }],
    onOpen: m => $$("[data-d]", m).forEach(b => b.onclick = () => { const d = new Date(dayStart() + Number(b.dataset.d) * 864e5 + 9 * 36e5); $("#td", m).value = iso(d); }),
  });
}

/* ================================================================
   TÂCHES
   ================================================================ */
export function taskRow(t) {
  const late = !t.done && t.due < dayStart();
  const today = !t.done && t.due >= dayStart() && t.due < dayStart() + 864e5;
  const refs = [
    t.clientId && `<a href="#/contacts/${t.clientId}">${icon("users", "sm")} ${h(t.clientName || "contact")}</a>`,
    t.quoteId && `<a href="#/devis/${t.quoteId}">${icon("file", "sm")} ${h(t.quoteNumber || "devis")}</a>`,
    t.requestId && `<a href="#/demandes/${t.requestId}">${icon("msg", "sm")} ${h(t.requestNumber || "demande")}</a>`,
    t.prospectId && `<a href="#/prospection">${icon("trend", "sm")} ${h(t.prospectName || "prospect")}</a>`,
  ].filter(Boolean);
  return `<div class="task ${t.done ? "done" : ""}" data-task="${t.id}">
    <input type="checkbox" ${t.done ? "checked" : ""} title="Terminer">
    ${t.priority === "high" && !t.done ? `<span class="prio" title="Priorité haute"></span>` : ""}
    <div class="ttl"><div>${h(t.title)}${t.auto ? ` <small class="faint" title="Créée automatiquement">⚡</small>` : ""}</div>
      <div class="refs"><span class="due ${late ? "late" : ""}">${late ? "En retard · " : today ? "Aujourd'hui · " : ""}${new Date(t.due).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>${refs.join(" ")}</div></div>
    <button class="btn sm ghost icon" data-tedit title="Modifier / reporter">${icon("pen", "sm")}</button>
  </div>`;
}
export function bindTaskRows(root, onChange) {
  if (!root) return;
  $$("[data-task]", root).forEach(row => {
    const id = row.dataset.task;
    $("input[type=checkbox]", row).onchange = async e => {
      try { await api("PUT", `/tasks/${id}`, { done: e.target.checked }); row.classList.toggle("done", e.target.checked); refreshCounts(); if (e.target.checked) toast("Tâche terminée ✔"); }
      catch (err) { fail(err); }
    };
    $("[data-tedit]", row).onclick = async () => {
      const t = (S.tasks || []).find(x => x.id === id) || (await api("GET", "/tasks")).find(x => x.id === id);
      taskModal({}, onChange, t);
    };
  });
}

export async function renderTasks(main) {
  await refreshCounts();
  const T = S.tasks || [];
  const today = dayStart(), tomorrow = today + 864e5;
  const groups = [
    ["En retard", T.filter(t => !t.done && t.due < today), "danger"],
    ["Aujourd'hui", T.filter(t => !t.done && t.due >= today && t.due < tomorrow), "info"],
    ["Cette semaine", T.filter(t => !t.done && t.due >= tomorrow && t.due < today + 7 * 864e5), "neutral"],
    ["Plus tard", T.filter(t => !t.done && t.due >= today + 7 * 864e5), "neutral"],
  ];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Tâches</h1><p>Relances, BAT à préparer, productions à lancer… Les tâches marquées ⚡ sont créées automatiquement.</p></div>
    <button class="btn primary" id="add">${icon("plus")} Nouvelle tâche</button></div>
    <div class="card" style="margin-bottom:16px"><div class="card-b row" style="flex-wrap:nowrap"><input type="text" id="quick" placeholder="Ajout rapide : « Commander les sweats Kariban » puis Entrée"><button class="btn" id="qadd">Ajouter</button></div></div>
    <div class="stack">${groups.map(([l, list, tone]) => list.length ? `<div class="card"><div class="card-h"><h3>${l}</h3>${badge(list.length, tone, true)}</div><div class="tg">${list.map(taskRow).join("")}</div></div>` : "").join("") ||
      `<div class="card empty"><div class="ico">${icon("check")}</div><b>Aucune tâche en cours</b><p>Bravo, tout est à jour !</p></div>`}
    ${T.some(t => t.done) ? `<details class="card"><summary class="card-h" style="cursor:pointer"><h3>Terminées récemment</h3></summary><div class="tg">${T.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30).map(taskRow).join("")}</div></details>` : ""}</div>`;
  const reload = () => renderTasks(main);
  $$(".tg", main).forEach(g => bindTaskRows(g, reload));
  $("#add").onclick = () => taskModal({}, reload);
  const quick = async () => {
    const title = $("#quick").value.trim();
    if (!title) return;
    try { await api("POST", "/tasks", { title, due: Date.now() }); reload(); } catch (e) { fail(e); }
  };
  $("#qadd").onclick = quick;
  $("#quick").onkeydown = e => { if (e.key === "Enter") quick(); };
}

/* ================================================================
   DEMANDES DE DEVIS
   ================================================================ */
const REQ = { nouvelle: ["Nouvelle", "warning"], en_cours: ["En cours", "info"], devis: ["Devis envoyé", "violet"], gagnee: ["Gagnée", "success"], perdue: ["Perdue", "danger"], archivee: ["Archivée", "neutral"] };
const reqBadge = s => badge(REQ[s]?.[0] || s, REQ[s]?.[1] || "neutral");
let rf = "open";
export async function renderRequests(main) {
  let list = [], inbox = [];
  try { [list, inbox] = await Promise.all([api("GET", "/requests"), api("GET", "/inbox")]); S.requests = list; } catch (e) { fail(e); }
  const link = `${location.origin}/devis/demande.html`;
  const tabs = [["open", "À traiter"], ["nouvelle", "Nouvelles"], ["devis", "Devis envoyé"], ["gagnee", "Gagnées"], ["perdue", "Perdues"], ["all", "Toutes"], ["inbox", `Emails non rattachés (${inbox.length})`]];
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Demandes de devis</h1><p>Reçues via votre formulaire en ligne, par email ou saisies après un appel.</p></div>
    <button class="btn" id="cp">${icon("link")} Lien du formulaire</button>
    <button class="btn primary" id="add">${icon("plus")} Saisir une demande</button></div>
    <div class="card"><div class="toolbar"><div class="seg" id="rs">${tabs.map(([k, l]) => `<button data-s="${k}" class="${rf === k ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="rl"></div></div>`;
  const draw = () => {
    if (rf === "inbox") {
      $("#rl").innerHTML = inbox.length ? `<table class="t"><tbody>${inbox.map(m => `<tr><td><b>${h(m.fromName || m.from)}</b><br><small>${h(m.from)}</small></td><td><b>${h(m.subject)}</b><br><small class="muted">${h(m.text.slice(0, 160))}…</small></td><td><small>${fmtDate(m.date, true)}</small></td>
        <td class="r" style="white-space:nowrap"><button class="btn sm" data-ib="request" data-id="${m.id}">→ Demande</button> <button class="btn sm" data-ib="contact" data-id="${m.id}">→ Contact</button> <button class="btn sm ghost" data-ib="archive" data-id="${m.id}">${icon("x", "sm")}</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><div class="ico">${icon("msg")}</div>${S.imapEnabled ? "Aucun email en attente. Les emails de vos contacts connus sont rattachés automatiquement à leur fiche." : "Activez la lecture des emails (Paramètres > Emails) pour voir ici les emails d'expéditeurs inconnus."}</div>`;
      $$("[data-ib]").forEach(b => b.onclick = async () => {
        try { const r = await api("POST", `/inbox/${b.dataset.id}/${b.dataset.ib}`); if (r.requestId) location.hash = `#/demandes/${r.requestId}`; else if (r.clientId) location.hash = `#/contacts/${r.clientId}`; else renderRequests(main); } catch (e) { fail(e); }
      });
      return;
    }
    const rows = list.filter(r => rf === "all" || (rf === "open" ? ["nouvelle", "en_cours"].includes(r.status) : r.status === rf));
    $("#rl").innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>N°</th><th>Contact</th><th>Besoin</th><th class="r">Pièces</th><th>Pour le</th><th>Statut</th><th>Reçue</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="click" data-r="${r.id}"><td><b>${h(r.number)}</b>${r.status === "nouvelle" ? ` <span class="attention-dot"></span>` : ""}</td>
        <td><b>${h(r.contact.company || r.contact.contact)}</b><br><small>${h(r.contact.company ? r.contact.contact : r.contact.email)}</small></td>
        <td>${h(r.subject || r.items.map(i => i.product).filter(Boolean).join(", ") || r.message.slice(0, 60))}${r.files.length ? ` <span class="chip">${icon("image", "sm")} ${r.files.length}</span>` : ""}</td>
        <td class="r">${r.items.reduce((s, i) => s + i.quantity, 0) || "—"}</td><td>${r.deadline ? fmtDate(r.deadline) : "—"}</td>
        <td>${reqBadge(r.status)} <small class="muted">${{ form: "formulaire", email: "email", manuel: "saisie" }[r.source] || h(r.source)}</small></td><td><small>${ago(r.createdAt)}</small></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="ico">${icon("msg")}</div><b>Aucune demande ici</b><p>Partagez le lien de votre formulaire (site web, réseaux sociaux, signature d'email) pour recevoir des demandes complètes avec visuels et dimensions.</p></div>`;
    $$("[data-r]").forEach(t => t.onclick = () => location.hash = `#/demandes/${t.dataset.r}`);
  };
  $$("#rs button").forEach(b => b.onclick = () => { rf = b.dataset.s; $$("#rs button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  $("#cp").onclick = () => modal({
    title: "Votre formulaire de demande de devis",
    body: `<p style="margin-top:0">Partagez ce lien sur votre site, vos réseaux, votre signature d'email ou en QR code au salon :</p>
      <div class="input-group"><input readonly value="${h(link)}" id="fl"><button class="btn" id="fc" style="border-radius:0 8px 8px 0">${icon("copy", "sm")} Copier</button></div>
      <p>Pour l'intégrer directement dans une page de votre site :</p><div class="code-box">${h(`<iframe src="${link}?embed=1" style="width:100%;min-height:1400px;border:0"></iframe>`)}</div>
      <p class="hint"><a href="${h(link)}" target="_blank">Ouvrir le formulaire →</a></p>`,
    onOpen: m => { $("#fc", m).onclick = () => { navigator.clipboard.writeText(link); toast("Lien copié"); }; },
  });
  $("#add").onclick = () => manualRequest(main);
  draw();
}

function manualRequest() {
  modal({
    title: "Saisir une demande (appel, salon, visite…)", size: "wide",
    body: `<div class="grid g3">${[["company", "Structure"], ["contact", "Contact"], ["email", "Email"], ["phone", "Téléphone"], ["city", "Ville"]].map(([k, l]) => `<label class="f"><span>${l}</span><input type="text" data-c="${k}"></label>`).join("")}
      <label class="f"><span>Date souhaitée</span><input type="date" id="mdl"></label></div>
      <label class="f" style="margin-top:10px"><span>Objet</span><input type="text" id="msu" placeholder="Ex. : Tenues tournoi de mai"></label>
      <div class="grid g3" style="margin-top:10px"><label class="f"><span>Article</span><input type="text" id="mpr" placeholder="T-shirt, sweat…"></label><label class="f"><span>Quantité</span><input type="number" id="mqt"></label><label class="f"><span>Tailles</span><input type="text" id="msz" placeholder="S:10, M:20…"></label></div>
      <label class="f" style="margin-top:10px"><span>Notes</span><textarea id="mms" rows="4"></textarea></label>`,
    actions: [{ label: "Annuler" }, { label: "Créer la demande", cls: "primary", onClick: async m => {
      const contact = Object.fromEntries($$("[data-c]", m).map(i => [i.dataset.c, i.value.trim()]));
      if (!contact.company && !contact.contact && !contact.email) throw new Error("Indiquez au moins un contact.");
      const items = $("#mpr", m).value || $("#mqt", m).value ? [{ product: $("#mpr", m).value, quantity: $("#mqt", m).value, sizes: $("#msz", m).value, positions: [] }] : [];
      const r = await api("POST", "/requests", { contact, subject: $("#msu", m).value, message: $("#mms", m).value, items, deadline: $("#mdl", m).value ? new Date($("#mdl", m).value).getTime() : null, source: "manuel" });
      refreshCounts(); location.hash = `#/demandes/${r.id}`;
    } }],
  });
}

export async function renderRequest(main, id) {
  let r;
  try { r = (await api("GET", "/requests")).find(x => x.id === id); } catch (e) { fail(e); }
  if (!r) { main.innerHTML = `<div class="empty">Demande introuvable — <a href="#/demandes">retour</a></div>`; return; }
  const qty = r.items.reduce((s, i) => s + i.quantity, 0);
  main.innerHTML = `<div class="page-head"><a class="btn icon ghost" href="#/demandes">${icon("back")}</a>
    <div class="grow"><div class="row" style="gap:8px"><h1>${h(r.number)}</h1>${reqBadge(r.status)}</div><p>Reçue ${ago(r.createdAt)} · ${{ form: "formulaire en ligne", email: "par email", manuel: "saisie manuelle" }[r.source] || h(r.source)}${r.deadline ? ` · pour le <b>${fmtDate(r.deadline)}</b>` : ""}</p></div>
    <button class="btn" id="rmail">${icon("send")} Répondre</button>
    ${["perdue", "archivee"].includes(r.status) ? `<button class="btn" id="reopen">Rouvrir</button>` : `<button class="btn" id="lost">Perdue</button>`}
    ${r.quoteId ? `<a class="btn primary" href="#/devis/${r.quoteId}">${icon("file")} Ouvrir le devis</a>` : `<button class="btn primary" id="conv">${icon("sparkle")} Créer le devis</button>`}</div>
  <div class="grid g2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>${h(r.subject || "Besoin")}</h2><small class="muted">${qty} pièce${qty > 1 ? "s" : ""}</small></div><div class="card-b stack">
        ${r.items.map((it, i) => `<div class="step-card"><div class="row between"><b>${i + 1}. ${h(it.product || "Article")}${it.color ? ` — ${h(it.color)}` : ""}</b><span class="chip">${it.quantity} pcs</span></div>
          ${it.sizes ? `<div><small class="muted">Tailles :</small> ${h(it.sizes)}</div>` : ""}
          ${it.positions.map(p => `<div style="font-size:13px;margin-top:4px">◆ ${h(p.position || "Emplacement ?")}${p.w && p.h ? ` · <b>${p.w}×${p.h} cm</b>` : ""}${p.technique ? ` · ${h(S.techniques.find(t => t.id === p.technique)?.name || p.technique)}` : ""}${p.colors > 1 ? ` · ${p.colors} couleurs` : ""}</div>`).join("")}
          ${it.notes ? `<div style="margin-top:4px"><small>${h(it.notes)}</small></div>` : ""}</div>`).join("") || `<small class="muted">Pas d'article détaillé.</small>`}
        ${r.message ? `<div><div class="section-lbl">Message</div><div style="white-space:pre-wrap">${h(r.message)}</div></div>` : ""}
        ${r.budget || r.event ? `<div class="row">${r.budget ? `<span class="chip">Budget : ${h(r.budget)}</span>` : ""}${r.event ? `<span class="chip">Événement : ${h(r.event)}</span>` : ""}</div>` : ""}
      </div></div>
      ${r.files.length ? `<div class="card"><div class="card-h"><h2>Visuels du client</h2></div><div class="card-b"><div class="bat-files">${r.files.map(f => `<div class="bat-file">${f.type === "pdf" ? `<a class="pdf" href="${h(f.url)}" target="_blank">${icon("file")}PDF</a>` : `<img src="${h(f.url)}" data-lb="${h(f.url)}">`}<div class="name"><a href="${h(f.url)}" download>${h(f.name || "fichier")}</a></div></div>`).join("")}</div></div></div>` : ""}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Contact</h3>${r.clientId ? `<a class="btn sm ghost" href="#/contacts/${r.clientId}">Fiche →</a>` : ""}</div><div class="card-b"><dl class="kv">
        ${r.contact.company ? `<dt>Structure</dt><dd>${h(r.contact.company)}</dd>` : ""}${r.contact.contact ? `<dt>Contact</dt><dd>${h(r.contact.contact)}</dd>` : ""}
        <dt>Email</dt><dd><a href="mailto:${h(r.contact.email)}">${h(r.contact.email)}</a></dd>${r.contact.phone ? `<dt>Téléphone</dt><dd><a href="tel:${h(r.contact.phone)}">${h(r.contact.phone)}</a></dd>` : ""}
        ${r.contact.city ? `<dt>Ville</dt><dd>${h([r.contact.zip, r.contact.city].filter(Boolean).join(" "))}</dd>` : ""}</dl></div></div>
      <div class="card"><div class="card-h"><h3>Notes internes</h3></div><div class="card-b"><textarea id="rn" rows="4">${h(r.notes)}</textarea><div class="row end" style="margin-top:8px"><button class="btn sm" id="rns">Enregistrer</button></div></div></div>
      <div class="banner t-info" style="margin:0">${icon("sparkle")}<div class="grow"><b>Créer le devis</b> pré-remplit automatiquement articles, tailles, emplacements et dimensions, et joint les visuels au dossier.</div></div>
    </div></div>`;
  $$("[data-lb]", main).forEach(i => i.onclick = () => lightbox(i.dataset.lb));
  const upd = async body => { try { await api("PUT", `/requests/${r.id}`, body); refreshCounts(); renderRequest(main, id); } catch (e) { fail(e); } };
  $("#rns").onclick = async () => { await upd({ notes: $("#rn").value }); toast("Notes enregistrées"); };
  if ($("#conv")) $("#conv").onclick = async () => { try { const q = await api("POST", `/requests/${r.id}/convert`); await reloadQuotes(); refreshCounts(); toast("Devis pré-rempli créé — vérifiez les articles et tailles"); location.hash = `#/devis/${q.id}`; } catch (e) { fail(e); } };
  if ($("#lost")) $("#lost").onclick = () => modal({
    title: "Marquer la demande comme perdue",
    body: `<label class="f"><span>Raison</span><select id="lr">${(S.settings.lostReasons || []).map(x => `<option>${h(x)}</option>`).join("")}</select></label>`,
    actions: [{ label: "Annuler" }, { label: "Confirmer", cls: "danger", onClick: m => upd({ status: "perdue", lostReason: $("#lr", m).value }) }],
  });
  if ($("#reopen")) $("#reopen").onclick = () => upd({ status: "en_cours" });
  $("#rmail").onclick = () => emailComposer({ to: r.contact.email, name: r.contact.contact, subject: `Re: votre demande ${r.number}`, requestId: r.id, clientId: r.clientId },
    () => { if (r.status === "nouvelle") upd({ status: "en_cours" }); });
}

/* ================================================================
   PIPELINE
   ================================================================ */
export async function renderPipeline(main) {
  await Promise.all([reloadQuotes(), refreshCounts()]).catch(fail);
  const Q = S.quotes, R = (S.requests || []).filter(r => ["nouvelle", "en_cours"].includes(r.status) && !r.quoteId);
  const recent = Date.now() - 45 * 864e5;
  const cols = [
    ["Demandes", R.map(r => ({ href: `#/demandes/${r.id}`, t: r.contact.company || r.contact.contact, m: `${r.number} · ${r.items.reduce((s, i) => s + i.quantity, 0)} pcs`, v: 0, at: r.createdAt }))],
    ["Devis en préparation", Q.filter(q => q.status === "brouillon")],
    ["Envoyés", Q.filter(q => q.status === "envoye")],
    ["Acceptés (BAT)", Q.filter(q => q.status === "accepte")],
    ["En production", Q.filter(q => q.status === "production")],
    ["Expédiés / livrés", Q.filter(q => ["expedie", "livre"].includes(q.status) && q.updatedAt > recent)],
  ];
  const card = q => q.href ? `<a class="kcard" href="${q.href}" style="display:block;text-decoration:none;color:inherit"><div class="t"><span>${h(q.t)}</span></div><div class="m">${h(q.m)} · ${ago(q.at)}</div></a>`
    : `<a class="kcard" href="#/devis/${q.id}" style="display:block;text-decoration:none;color:inherit"><div class="t"><span>${h(q.client.company || q.client.contact || "—")}</span><span class="num">${fmtEUR(q.totals.ht)}</span></div>
      <div class="m">${h(q.number)}${q.title ? ` · ${h(q.title)}` : ""}</div><div class="chips">${q.attention ? `<span class="chip warn">activité client</span>` : ""}${q.viewedAt && q.status === "envoye" ? `<span class="chip">vu ${ago(q.viewedAt)}</span>` : ""}${q.batStatus === "modif" ? `<span class="chip red">BAT à corriger</span>` : q.batStatus === "en_attente" ? `<span class="chip warn">BAT en attente</span>` : q.batStatus === "valide" ? `<span class="chip green">BAT validé</span>` : ""}${q.deadline ? `<span class="chip ${q.deadline < Date.now() + 5 * 864e5 ? "red" : "gray"}">pour le ${fmtDate(q.deadline)}</span>` : ""}</div></a>`;
  const sent = Q.filter(q => q.sentAt || SIGNED.includes(q.status) || q.status === "refuse");
  const conv = sent.length ? Math.round(Q.filter(q => SIGNED.includes(q.status)).length / sent.length * 100) : 0;
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Pipeline commercial</h1><p>De la demande à la livraison · taux de transformation : <b>${conv} %</b> · en jeu : <b>${fmtEUR(Q.filter(q => ["brouillon", "envoye"].includes(q.status)).reduce((s, q) => s + (q.totals.ht || 0), 0))} HT</b></p></div></div>
    <div class="kanban">${cols.map(([l, list]) => `<div class="kcol"><div class="kcol-h">${h(l)} <span class="n">${list.length}</span><span class="sum">${list[0]?.totals ? fmtEUR(list.reduce((s, q) => s + (q.totals?.ht || 0), 0)) : ""}</span></div>${list.map(card).join("")}</div>`).join("")}</div>`;
}

export { reqBadge, statusBadge };
