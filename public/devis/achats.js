/* Achats & banque : commande fournisseur, virements Qonto, modèles de devis, tarifs fournisseurs. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, ago, uid, clone, download, toCSV, parseCSV, readAsText, pickFiles, parseNum } from "./ui.js";

/* ================================================================
   COMMANDE FOURNISSEUR
   ================================================================ */
export async function renderPurchasing(main) {
  let d = { suppliers: [], quotes: [] };
  try { d = await api("GET", "/purchasing"); } catch (e) { fail(e); }
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Achats</h1><p>Textile et objets à commander pour les commandes en production (BAT validé), regroupés par fournisseur, référence, couleur et taille. Le stock disponible est déduit.</p></div>
    <button class="btn" id="sup">${icon("users")} Fournisseurs</button></div>
    ${d.quotes.length ? `<div class="banner t-info">${icon("file")}<div class="grow">Commandes concernées : ${d.quotes.map(q => `<a href="#/devis/${q.id}">${h(q.number)}</a> <small class="muted">${h(q.client)}${q.deadline ? ` · pour le ${fmtDate(q.deadline)}` : ""}</small>`).join(" · ")}</div></div>` : ""}
    <div class="stack" id="sups">${d.suppliers.map((s, i) => supplierCard(s, i)).join("") || `<div class="card empty"><div class="ico">${icon("check")}</div><b>Rien à commander</b><p>Les commandes apparaissent ici dès que le BAT est validé (étape « À lancer » de la production).</p></div>`}</div>`;
  d.suppliers.forEach((s, i) => {
    const el = $(`[data-sup="${i}"]`);
    const text = () => `Bonjour,\n\nMerci de bien vouloir nous livrer la commande suivante :\n\n${s.rows.filter(r => r.toOrder).map(r => `- ${r.ref} ${r.name} — ${r.color} — ${r.size} : ${r.toOrder}`).join("\n")}\n\nTotal : ${s.rows.reduce((x, r) => x + r.toOrder, 0)} pièces.\nMerci de nous confirmer le délai.\n\n${S.settings.emailSignature || S.settings.company.name || ""}`;
    $("[data-copy]", el).onclick = () => { navigator.clipboard.writeText(text()); toast("Commande copiée"); };
    $("[data-csv]", el).onclick = () => download(`commande-${s.name}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([["Référence", "Désignation", "Couleur", "Taille", "Quantité", "Stock", "À commander", "Devis"], ...s.rows.map(r => [r.ref, r.name, r.color, r.size, r.qty, r.inStock, r.toOrder, r.numbers.join(" ")])]), "text/csv");
    $("[data-mail]", el).onclick = () => {
      modal({
        title: `Envoyer la commande à ${s.name}`, size: "wide",
        body: `<label class="f"><span>À</span><input type="email" id="so" value="${h(s.email)}"></label><label class="f" style="margin-top:10px"><span>Message</span><textarea id="st" rows="14">${h(text())}</textarea></label>`,
        actions: [{ label: "Annuler" }, { label: S.mailEnabled ? "Envoyer" : "Ouvrir ma messagerie", cls: "primary", icon: "send", onClick: async m => {
          const to = $("#so", m).value.trim(), body = $("#st", m).value, subject = `Commande ${S.settings.company.name || ""} — ${new Date().toLocaleDateString("fr-FR")}`;
          if (S.mailEnabled) await api("POST", "/purchasing/email", { to, subject, text: body, supplier: s.name });
          else location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          toast("Commande envoyée");
        } }],
      });
    };
    $("[data-done]", el).onclick = async () => {
      if (!(await confirmBox(`Commande passée chez ${s.name} ?`, "Les lignes sont marquées « commandées » ; un devis dont tout est commandé passe à l'étape « Textile commandé » de la production.", { label: "Oui, c'est commandé" }))) return;
      try { await api("POST", "/purchasing/order", { supplier: s.name, quoteIds: s.quoteIds }); toast("Commande enregistrée"); renderPurchasing(main); } catch (e) { fail(e); }
    };
  });
  $("#sup").onclick = () => suppliersModal(() => renderPurchasing(main));
}

function supplierCard(s, i) {
  const total = s.rows.reduce((x, r) => x + r.toOrder, 0);
  return `<div class="card" data-sup="${i}"><div class="card-h"><h2>${h(s.name)}</h2>${badge(`${total} pièce${total > 1 ? "s" : ""} à commander`, total ? "warning" : "success", true)}
      <button class="btn sm" data-copy>${icon("copy", "sm")} Copier</button><button class="btn sm" data-csv>${icon("download", "sm")} CSV</button>
      <button class="btn sm" data-mail>${icon("send", "sm")} Envoyer</button><button class="btn sm primary" data-done>${icon("check", "sm")} Marquer commandé</button></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Référence</th><th>Désignation</th><th>Couleur</th><th>Taille</th><th class="r">Besoin</th><th class="r">En stock</th><th class="r">À commander</th><th>Devis</th></tr></thead><tbody>
    ${s.rows.map(r => `<tr><td><b>${h(r.ref)}</b></td><td>${h(r.name)}</td><td>${h(r.color)}</td><td><span class="chip">${h(r.size)}</span></td><td class="r">${r.qty}</td><td class="r">${r.inStock || "—"}</td><td class="r"><b>${r.toOrder}</b></td><td><small>${r.numbers.map(h).join(", ")}</small></td></tr>`).join("")}
    </tbody></table></div></div>`;
}

function suppliersModal(done) {
  const list = clone(S.settings.suppliers || []);
  const brands = [...new Set(S.catalog.map(a => a.brand).filter(Boolean))];
  for (const b of brands) if (!list.some(x => x.name.toLowerCase() === b.toLowerCase())) list.push({ name: b, email: "", notes: "" });
  const m = modal({
    title: "Fournisseurs", size: "wide",
    body: `<p class="hint" style="margin-top:0">Le fournisseur d'un article est sa <b>marque</b> dans les références. Indiquez l'email de commande de chacun.</p><div id="sl"></div><button class="btn sm" id="sa" style="margin-top:8px">${icon("plus", "sm")} Ajouter</button>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async () => {
      S.settings.suppliers = await api("PUT", "/suppliers", list); toast("Fournisseurs enregistrés"); done?.();
    } }],
  });
  const draw = () => {
    $("#sl", m.el).innerHTML = list.map((s, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><input class="sm" data-i="${i}" data-f="name" value="${h(s.name)}" placeholder="Nom (= marque)"><input class="sm" type="email" data-i="${i}" data-f="email" value="${h(s.email)}" placeholder="commandes@fournisseur.fr"><input class="sm" data-i="${i}" data-f="notes" value="${h(s.notes)}" placeholder="N° client, conditions…"><button class="btn sm ghost icon" data-rm="${i}">${icon("trash", "sm")}</button></div>`).join("");
    $$("[data-i]", m.el).forEach(el => el.oninput = () => list[el.dataset.i][el.dataset.f] = el.value);
    $$("[data-rm]", m.el).forEach(b => b.onclick = () => { list.splice(+b.dataset.rm, 1); draw(); });
  };
  $("#sa", m.el).onclick = () => { list.push({ name: "", email: "", notes: "" }); draw(); };
  draw();
}

/* ================================================================
   VIREMENTS QONTO (dans Facturation)
   ================================================================ */
export async function bankSection(box, reload) {
  let d;
  try { d = await api("GET", "/bank/matches"); } catch (e) { box.innerHTML = ""; return; }
  if (!d.enabled) {
    box.innerHTML = `<div class="banner t-info">${icon("card")}<div class="grow"><b>Connectez Qonto</b> : les virements reçus sont rapprochés automatiquement de vos devis (référence ou montant + nom), en lecture seule.</div><a class="btn sm" href="#/parametres/integrations">Connecter</a></div>`;
    return;
  }
  const sug = d.matches.filter(m => m.status === "suggested");
  const recent = d.matches.filter(m => ["auto", "confirmed"].includes(m.status)).slice(0, 8);
  const unmatched = d.matches.filter(m => m.status === "unmatched").slice(0, 8);
  box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>${icon("card")} Virements reçus (Qonto)</h2>
      <small class="muted">${d.state.lastSync ? `synchro ${ago(d.state.lastSync)}` : "jamais synchronisé"}${d.state.lastError ? ` · <span style="color:var(--danger)">${h(d.state.lastError)}</span>` : ""}</small>
      <button class="btn sm" id="qsync">${icon("refresh", "sm")} Synchroniser</button></div>
    <div class="card-b stack">
      ${sug.length ? `<div><div class="section-lbl">À confirmer (${sug.length})</div>${sug.map(m => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:nowrap" data-m="${m.id}">
        <div style="flex:1;min-width:0"><b class="num">${fmtEUR(m.amount)}</b> — ${h(m.label)} <small class="muted">${h(m.reference)} · ${fmtDate(m.date)} · ${h(m.reason || "")}</small></div>
        <select class="sm" data-q style="width:230px">${(m.candidates || []).map(c => `<option value="${c.quoteId}|${c.kind}" ${c.quoteId === m.quoteId ? "selected" : ""}>${h(c.number)} — ${c.kind === "acompte" ? "acompte" : "solde / total"}</option>`).join("")}</select>
        <button class="btn sm primary" data-ok>Confirmer</button><button class="btn sm ghost" data-no>Ignorer</button></div>`).join("")}</div>` : ""}
      ${recent.length ? `<div><div class="section-lbl">Rapprochés</div>${recent.map(m => `<div style="font-size:13px;padding:3px 0">✅ <b class="num">${fmtEUR(m.amount)}</b> — ${h(m.label)} → <b>${h(m.number)}</b> <small class="muted">(${m.kind === "acompte" ? "acompte" : "paiement"}, ${m.status === "auto" ? h(m.reason) : "confirmé"} · ${fmtDate(m.date)})</small></div>`).join("")}</div>` : ""}
      ${unmatched.length ? `<details><summary class="muted" style="cursor:pointer">Autres crédits non rattachés (${unmatched.length})</summary>${unmatched.map(m => `<div style="font-size:12.5px;padding:3px 0">${fmtEUR(m.amount)} — ${h(m.label)} ${h(m.reference)} <small class="muted">${fmtDate(m.date)}</small></div>`).join("")}</details>` : ""}
      ${!sug.length && !recent.length ? `<small class="muted">Aucun virement correspondant à un devis pour l'instant.</small>` : ""}
    </div></div>`;
  $("#qsync", box).onclick = async () => { try { const r = await api("POST", "/qonto/sync"); toast(`${r.new} nouvelle(s) opération(s), ${r.auto || 0} rapprochée(s)`); reload(); } catch (e) { fail(e); } };
  $$("[data-m]", box).forEach(row => {
    $("[data-ok]", row).onclick = async () => { const [quoteId, kind] = ($("[data-q]", row).value || "|").split("|"); try { await api("POST", `/bank/matches/${row.dataset.m}/confirm`, { quoteId, kind }); toast("Paiement enregistré"); reload(); } catch (e) { fail(e); } };
    $("[data-no]", row).onclick = async () => { await api("POST", `/bank/matches/${row.dataset.m}/ignore`); reload(); };
  });
}

/* ================================================================
   MODÈLES DE DEVIS
   ================================================================ */
export async function templatePicker(onPick) {
  let list = [];
  try { list = await api("GET", "/quote-templates"); } catch (e) { return fail(e); }
  const m = modal({
    title: "Nouveau devis depuis un modèle", size: "wide",
    body: list.length ? `<table class="t"><tbody>${list.map(t => `<tr class="click" data-t="${t.id}"><td><b>${h(t.name)}</b><br><small class="muted">${t.lines.length} ligne(s) · créé depuis ${h(t.from)} · ${fmtDate(t.createdAt)}</small></td><td><small>${h(t.lines.map(l => l.name).join(", ")).slice(0, 120)}</small></td><td class="r"><button class="btn sm ghost icon" data-del="${t.id}">${icon("trash", "sm")}</button></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Aucun modèle. Ouvrez un devis et cliquez sur « Enregistrer comme modèle ».</div>`,
  });
  $$("[data-t]", m.el).forEach(r => r.onclick = e => {
    if (e.target.closest("[data-del]")) return;
    const t = list.find(x => x.id === r.dataset.t);
    m.close();
    const lines = clone(t.lines).map(l => ({ ...l, id: uid("l"), ordered: false, perso: (l.perso || []).map(p => ({ ...p, id: uid("p") })) }));
    onPick({ title: t.title, lines, fees: clone(t.fees || []).map(f => ({ ...f, id: uid("fe") })), notes: t.notes, discountPct: t.discountPct, shipping: t.shipping });
  });
  $$("[data-del]", m.el).forEach(b => b.onclick = async () => {
    if (!(await confirmBox("Supprimer ce modèle ?", "Les devis déjà créés ne sont pas affectés.", { danger: true, label: "Supprimer" }))) return;
    await api("DELETE", `/quote-templates/${b.dataset.del}`); m.close(); templatePicker(onPick);
  });
}

export function saveAsTemplate(q) {
  modal({
    title: "Enregistrer comme modèle",
    body: `<label class="f"><span>Nom du modèle</span><input type="text" id="tn" value="${h(q.title || "")}" placeholder="Ex. : Pack club 50 maillots"></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="tk"> Garder aussi les quantités par taille</label>`,
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async m => {
      await api("POST", "/quote-templates", { fromQuoteId: q.id, name: $("#tn", m).value, keepQty: $("#tk", m).checked });
      toast("Modèle enregistré — disponible dans Devis › Depuis un modèle");
    } }],
  });
}

/* ================================================================
   TARIFS FOURNISSEURS
   ================================================================ */
export function supplierPricesModal(done) {
  let items = [];
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]/g, " ").trim();
  const m = modal({
    title: "Mettre à jour les prix fournisseur", size: "wide",
    body: `<p style="margin-top:0">Déposez le tarif de votre fournisseur (CSV ou export Excel) : les prix d'achat des références correspondantes sont mis à jour et les devis en cours concernés vous sont signalés.</p>
      <div class="drop" id="dz">${icon("upload")}<div style="margin-top:6px"><b>Fichier tarif (CSV)</b><br><small>colonnes reconnues : référence + prix d'achat (prix, tarif, PA, prix HT…)</small></div></div>
      <div id="pv" style="margin-top:12px"></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="rd" checked> Recalculer automatiquement les devis en <b>brouillon</b> (les devis déjà envoyés gardent leur prix)</label>`,
    actions: [{ label: "Annuler" }, { label: "Mettre à jour", cls: "primary", onClick: async mm => {
      if (!items.length) throw new Error("Aucune ligne reconnue.");
      const r = await api("POST", "/catalog/prices", { items, refreshDrafts: $("#rd", mm).checked });
      S.catalog = await api("GET", "/catalog");
      resultModal(r); done?.();
    } }],
  });
  $("#dz", m.el).onclick = async () => {
    const [f] = await pickFiles({ accept: ".csv,text/csv", multiple: false });
    if (!f) return;
    const rows = parseCSV(await readAsText(f));
    const head = rows[0].map(norm);
    const iRef = head.findIndex(x => /^(ref|reference|code|sku|article)/.test(x));
    const iPrice = head.findIndex(x => /(prix|tarif|^pa$|cost|price)/.test(x));
    if (iRef < 0 || iPrice < 0) return fail("Colonnes « référence » et « prix » introuvables.");
    items = rows.slice(1).map(r => ({ ref: (r[iRef] || "").trim(), cost: parseNum(r[iPrice]) })).filter(x => x.ref && x.cost > 0);
    const known = items.filter(i => S.catalog.some(a => (a.ref || "").toLowerCase() === i.ref.toLowerCase())).length;
    $("#pv", m.el).innerHTML = `<p><b>${items.length}</b> prix lus · <b>${known}</b> correspondent à vos références.</p>`;
  };
}
function resultModal(r) {
  modal({
    title: `${r.updated} prix mis à jour`, size: "wide",
    body: `${r.changes.length ? `<div class="table-wrap" style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>Référence</th><th>Désignation</th><th class="r">Ancien</th><th class="r">Nouveau</th><th class="r">Évolution</th></tr></thead><tbody>
      ${r.changes.map(c => `<tr><td><b>${h(c.ref)}</b></td><td>${h(c.name)}</td><td class="r num">${fmtEUR(c.old)}</td><td class="r num">${fmtEUR(c.new)}</td><td class="r" style="color:${c.pct > 0 ? "var(--danger)" : "var(--success)"}">${c.pct > 0 ? "+" : ""}${c.pct ?? "—"} %</td></tr>`).join("")}</tbody></table></div>` : "<p>Aucun changement de prix.</p>"}
      ${r.refreshed ? `<p>✅ ${r.refreshed} brouillon(s) recalculé(s).</p>` : ""}
      ${r.affected.length ? `<div class="warn-list"><b>Devis en cours utilisant ces références</b> (les devis envoyés gardent leur prix ; ouvrez-les et cliquez « Actualiser tarifs » si besoin) :<br>${r.affected.map(q => `<a href="#/devis/${q.id}">${h(q.number)}</a> ${h(q.client)} (${q.status === "envoye" ? "envoyé" : "brouillon"})`).join(" · ")}</div>` : ""}
      ${r.unknown ? `<p class="hint">${r.unknown} référence(s) du fichier ne sont pas dans votre catalogue (ignorées).</p>` : ""}`,
    actions: [{ label: "Fermer", cls: "primary" }],
  });
}
