/* Boutiques club (administration) : création depuis un devis, produits et prix, commandes des membres, commande atelier. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, fmtDate, num, uid, clone, download, toCSV } from "./ui.js";

const PAY = { onsite: "Paiement auprès du club", online: "Paiement en ligne (carte)", both: "Au choix du membre" };

export async function renderShops(main) {
  let list = [];
  try { list = await api("GET", "/shops"); } catch (e) { fail(e); }
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Boutiques club</h1><p>Une page de commande pour les membres d'un club ou les salariés d'une entreprise : chacun choisit sa taille, son nom / numéro et paie ; vous recevez une seule commande regroupée.</p></div>
    <button class="btn primary" id="add">${icon("plus")} Nouvelle boutique</button></div>
    <div class="grid g2">${list.map(s => `<div class="card"><div class="card-h"><h2>${h(s.title)}</h2>${s.status === "open" ? badge("Ouverte", "success") : badge("Fermée", "neutral")}</div><div class="card-b stack">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)"><div><small class="muted">Commandes</small><b>${s.stats.orders}</b></div><div><small class="muted">Payées</small><b>${s.stats.paid}</b></div><div><small class="muted">Pièces</small><b>${s.stats.pieces}</b></div><div><small class="muted">Total TTC</small><b>${fmtEUR(s.stats.total)}</b></div></div>
      <small class="muted">${s.products.length} produit(s) · ${PAY[s.payment]}${s.deadline ? ` · jusqu'au ${fmtDate(s.deadline)}` : ""}</small>
      <div class="row"><button class="btn sm" data-copy="${h(s.link)}">${icon("link", "sm")} Copier le lien</button><a class="btn sm" href="${h(s.link)}" target="_blank">${icon("eye", "sm")} Voir</a>
        <button class="btn sm" data-edit="${s.id}">${icon("pen", "sm")} Modifier</button><button class="btn sm primary" data-orders="${s.id}">${icon("file", "sm")} Commandes</button></div>
    </div></div>`).join("") || `<div class="card empty" style="grid-column:1/-1"><div class="ico">${icon("shirt")}</div><b>Aucune boutique</b><p>Le plus simple : préparez un devis « type » pour le club (articles + marquages), puis créez la boutique depuis ce devis — les prix TTC unitaires sont repris.</p></div>`}</div>`;
  const reload = () => renderShops(main);
  $$("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast("Lien copié — à envoyer au club"); });
  $$("[data-edit]").forEach(b => b.onclick = () => shopEditor(list.find(s => s.id === b.dataset.edit), reload));
  $$("[data-orders]").forEach(b => b.onclick = () => ordersModal(list.find(s => s.id === b.dataset.orders), reload));
  $("#add").onclick = () => createShop(reload);
}

export function createShop(done, fromQuoteId = "") {
  const quotes = S.quotes.filter(q => q.lineCount);
  modal({
    title: "Nouvelle boutique club",
    body: `<label class="f"><span>À partir du devis</span><select id="nq"><option value="">— Boutique vide (produits à saisir) —</option>${quotes.map(q => `<option value="${q.id}" ${q.id === fromQuoteId ? "selected" : ""}>${h(q.number)} — ${h(q.client.company || q.client.contact)} ${h(q.title || "")}</option>`).join("")}</select></label>
      <label class="f" style="margin-top:10px"><span>Marge ajoutée sur le prix du devis (frais de gestion)</span><div class="input-group"><input type="number" id="nm" value="0" step="1"><span class="addon">%</span></div><div class="hint">Les prix sont ensuite arrondis au 0,50 € supérieur et restent modifiables.</div></label>
      <label class="f" style="margin-top:10px"><span>Nom affiché</span><input type="text" id="nt" placeholder="Ex. : AS Running Lyon — tenues 2026"></label>`,
    actions: [{ label: "Annuler" }, { label: "Créer", cls: "primary", onClick: async m => {
      const s = await api("POST", "/shops", { fromQuoteId: $("#nq", m).value || undefined, marginPct: num($("#nm", m).value) || 0, title: $("#nt", m).value });
      toast("Boutique créée"); done?.(); shopEditor(s, done);
    } }],
  });
}

function shopEditor(shop, done) {
  const s = clone(shop);
  const m = modal({
    title: s.title, size: "xwide",
    body: `<div class="grid g3"><label class="f" style="grid-column:span 2"><span>Nom de la boutique</span><input type="text" id="st" value="${h(s.title)}"></label>
      <label class="f"><span>Statut</span><select id="ss"><option value="open" ${s.status === "open" ? "selected" : ""}>Ouverte</option><option value="closed" ${s.status === "closed" ? "selected" : ""}>Fermée</option></select></label>
      <label class="f" style="grid-column:span 3"><span>Message aux membres</span><textarea id="si" rows="2" placeholder="Ex. : Commandez votre tenue avant le 15 novembre, remise lors de l'entraînement du 1er décembre.">${h(s.intro)}</textarea></label>
      <label class="f"><span>Date limite</span><input type="date" id="sd" value="${s.deadline ? new Date(s.deadline).toISOString().slice(0, 10) : ""}"></label>
      <label class="f"><span>Paiement</span><select id="sp">${Object.entries(PAY).map(([k, l]) => `<option value="${k}" ${s.payment === k ? "selected" : ""}>${l}</option>`).join("")}</select>${S.stripeEnabled ? "" : `<div class="hint">Paiement en ligne : nécessite la clé Stripe.</div>`}</label>
      <label class="f"><span>Email du responsable (récapitulatifs)</span><input type="email" id="se" value="${h(s.contactEmail || "")}"></label></div>
      <div class="row between" style="margin:18px 0 8px"><h3>Produits</h3><button class="btn sm" id="pa">${icon("plus", "sm")} Produit</button></div><div id="pl"></div>`,
    actions: [
      { label: "Supprimer", cls: "danger", icon: "trash", onClick: async () => { if (!(await confirmBox("Supprimer la boutique ?", "Le lien ne fonctionnera plus. Les commandes déjà reçues restent consultables dans les devis générés.", { danger: true, label: "Supprimer" }))) return false; await api("DELETE", `/shops/${s.id}`); done?.(); } },
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async mm => {
        read();
        await api("PUT", `/shops/${s.id}`, { title: $("#st", mm).value, status: $("#ss", mm).value, intro: $("#si", mm).value, payment: $("#sp", mm).value, contactEmail: $("#se", mm).value,
          deadline: $("#sd", mm).value ? new Date($("#sd", mm).value + "T23:59:00").getTime() : null, products: s.products });
        toast("Boutique enregistrée"); done?.();
      } },
    ],
  });
  const read = () => $$("[data-pi]", m.el).forEach(el => {
    const p = s.products[el.dataset.pi], f = el.dataset.f;
    p[f] = el.type === "checkbox" ? el.checked : ["price", "persoPrice"].includes(f) ? num(el.value) ?? 0 : ["sizes", "colors"].includes(f) ? el.value.split(",").map(x => x.trim()).filter(Boolean) : el.value;
  });
  const draw = () => {
    $("#pl", m.el).innerHTML = s.products.map((p, i) => `<div class="step-card"><div class="grid g4">
      <label class="f" style="grid-column:span 2"><span>Produit</span><input class="sm" data-pi="${i}" data-f="name" value="${h(p.name)}"></label>
      <label class="f"><span>Prix TTC</span><div class="input-group"><input type="number" step="0.5" class="sm" data-pi="${i}" data-f="price" value="${h(p.price)}"><span class="addon">€</span></div></label>
      <div class="row end"><button class="btn sm ghost icon" data-prm="${i}">${icon("trash", "sm")}</button></div>
      <label class="f" style="grid-column:span 2"><span>Tailles (séparées par des virgules)</span><input class="sm" data-pi="${i}" data-f="sizes" value="${h(p.sizes.join(", "))}"></label>
      <label class="f" style="grid-column:span 2"><span>Couleurs</span><input class="sm" data-pi="${i}" data-f="colors" value="${h(p.colors.join(", "))}"></label>
      <label class="f" style="grid-column:span 4"><span>Description</span><input class="sm" data-pi="${i}" data-f="description" value="${h(p.description)}"></label>
      <label class="check"><input type="checkbox" data-pi="${i}" data-f="persoName" ${p.persoName ? "checked" : ""}> Nom à floquer</label>
      <label class="check"><input type="checkbox" data-pi="${i}" data-f="persoNumber" ${p.persoNumber ? "checked" : ""}> Numéro</label>
      <label class="f"><span>Supplément perso</span><div class="input-group"><input type="number" step="0.5" class="sm" data-pi="${i}" data-f="persoPrice" value="${h(p.persoPrice)}"><span class="addon">€</span></div></label>
      ${p.line ? `<small class="muted" style="align-self:end">Fabrication : ${h(p.line.name)} — ${(p.line.perso || []).length} marquage(s)</small>` : `<small class="muted" style="align-self:end">Produit libre (à préciser dans le devis généré)</small>`}
    </div></div>`).join("") || `<small class="muted">Aucun produit.</small>`;
    $$("[data-prm]", m.el).forEach(b => b.onclick = () => { read(); s.products.splice(+b.dataset.prm, 1); draw(); });
  };
  $("#pa", m.el).onclick = () => { read(); s.products.push({ id: uid("sp"), name: "", price: 0, sizes: ["S", "M", "L", "XL"], colors: [], description: "", persoName: false, persoNumber: false, persoPrice: 0 }); draw(); };
  draw();
}

async function ordersModal(s, done) {
  let orders = [];
  try { orders = await api("GET", `/shops/${s.id}/orders`); } catch (e) { return fail(e); }
  const live = orders.filter(o => o.status !== "annulee");
  const recap = {};
  for (const o of live) for (const i of o.items) { const k = `${i.name}|${i.color}`; (recap[k] ||= {}); recap[k][i.size] = (recap[k][i.size] || 0) + i.qty; }
  const m = modal({
    title: `Commandes — ${s.title}`, size: "xwide",
    body: `<div class="section-lbl">Récapitulatif par taille</div>
      <div class="table-wrap"><table class="t"><tbody>${Object.entries(recap).map(([k, sz]) => `<tr><td><b>${h(k.split("|")[0])}</b> ${h(k.split("|")[1])}</td><td>${Object.entries(sz).map(([z, n]) => `<span class="sz chip">${h(z)} : ${n}</span>`).join(" ")}</td><td class="r"><b>${Object.values(sz).reduce((a, b) => a + b, 0)}</b></td></tr>`).join("") || `<tr><td class="muted">Aucune commande.</td></tr>`}</tbody></table></div>
      <div class="section-lbl" style="margin-top:16px">Commandes (${live.length})</div>
      <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th>N°</th><th>Membre</th><th>Articles</th><th class="r">Total</th><th>Paiement</th><th></th></tr></thead><tbody>
      ${orders.map(o => `<tr style="${o.status === "annulee" ? "opacity:.45" : ""}"><td><b>${h(o.number)}</b><br><small>${fmtDate(o.createdAt)}</small></td><td>${h(o.name)}<br><small>${h(o.email)} ${h(o.phone)}</small></td>
        <td><small>${o.items.map(i => `${i.qty}× ${h(i.name)} ${h(i.size)}${i.persoName || i.persoNumber ? ` (${h([i.persoName, i.persoNumber].filter(Boolean).join(" n°"))})` : ""}`).join("<br>")}</small></td>
        <td class="r num"><b>${fmtEUR(o.total)}</b></td>
        <td><select class="sm" data-pay="${o.id}"><option value="pending" ${o.payment.status !== "paid" ? "selected" : ""}>À régler${o.payment.mode === "online" ? " (carte)" : ""}</option><option value="paid" ${o.payment.status === "paid" ? "selected" : ""}>Payé</option></select></td>
        <td>${o.exportedAt ? badge("en fabrication", "violet", true) : o.status === "annulee" ? `<button class="link-btn" data-st="${o.id}:ok">Rétablir</button>` : `<button class="link-btn" data-st="${o.id}:annulee">Annuler</button>`}</td></tr>`).join("")}</tbody></table></div>`,
    actions: [
      { label: "Export CSV", icon: "download", onClick: () => { download(`boutique-${s.title}.csv`, toCSV([["N°", "Date", "Nom", "Email", "Téléphone", "Article", "Couleur", "Taille", "Qté", "Nom floqué", "Numéro", "Total ligne", "Paiement"],
        ...orders.flatMap(o => o.items.map(i => [o.number, fmtDate(o.createdAt), o.name, o.email, o.phone, i.name, i.color, i.size, i.qty, i.persoName, i.persoNumber, i.total, o.payment.status === "paid" ? "payé" : "à régler"]))]), "text/csv"); return false; } },
      { label: "Fermer" },
      { label: "Générer la commande atelier", cls: "primary", icon: "file", onClick: () => {
        const gen = async onlyPaid => { const r = await api("POST", `/shops/${s.id}/generate`, { onlyPaid }); toast(`${r.orders} commande(s) regroupée(s)`); location.hash = `#/devis/${r.id}`; };
        modal({ title: "Générer la commande atelier", body: `<p style="margin-top:0">Les commandes pas encore regroupées deviennent un devis atelier : quantités par taille et liste des noms / numéros à floquer.</p>`,
          actions: [{ label: "Annuler" }, { label: "Seulement les payées", onClick: () => gen(true) }, { label: "Toutes les commandes", cls: "primary", onClick: () => gen(false) }] });
        return false;
      } },
    ],
  });
  $$("[data-pay]", m.el).forEach(sel => sel.onchange = async () => { await api("PATCH", `/shops/${s.id}/orders/${sel.dataset.pay}`, { payment: sel.value }); toast("Paiement mis à jour"); done?.(); });
  $$("[data-st]", m.el).forEach(b => b.onclick = async () => { const [id, st] = b.dataset.st.split(":"); await api("PATCH", `/shops/${s.id}/orders/${id}`, { status: st }); m.close(); ordersModal(s, done); done?.(); });
}
