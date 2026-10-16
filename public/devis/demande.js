/* Formulaire public de demande de devis : coordonnées, articles, emplacements & dimensions, visuels. */
import { h, $, $$, icon, toast, fail, bindDrop, readAsDataURL, shrinkImage } from "./ui.js";

const params = new URLSearchParams(location.search);
if (params.has("embed")) document.body.classList.add("embed");
const root = $("#root");
const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const KIDS = ["4 ans", "6 ans", "8 ans", "10 ans", "12 ans", "14 ans"];
const PRESETS = [["Cœur", 9, 9], ["Poitrine centre", 25, 10], ["Dos", 28, 35], ["Haut du dos", 25, 8], ["Manche gauche", 7, 7], ["Nuque", 8, 4]];
let M = null;
const F = { items: [], files: [] };
const newItem = () => ({ product: "", articleId: "", color: "", quantity: "", sizes: {}, kids: false, notes: "", positions: [{ position: "Cœur", w: 9, h: 9, technique: "", colors: 1 }] });

async function call(method, url, body) {
  const r = await fetch(`/api/devis/public${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

function render() {
  const co = M.company;
  document.title = `Demande de devis — ${co.name || ""}`;
  root.innerHTML = `<div class="head"><div class="wrap">${co.logo ? `<img src="${h(co.logo)}" alt="">` : ""}<div><h1>Demande de devis personnalisé</h1><p>${h(M.intro || `${co.name || "Notre atelier"} vous répond rapidement avec un devis détaillé et un BAT à valider avant toute fabrication.`)}</p></div></div></div>
  <div class="wrap"><form class="card form" id="f" novalidate>
    <div class="sec"><h2><span class="n">1</span>Vos coordonnées</h2><div class="grid g2">
      <label class="f"><span>Structure (club, association, entreprise…)</span><input type="text" data-c="company" autocomplete="organization"></label>
      <label class="f"><span>Nom et prénom *</span><input type="text" data-c="contact" autocomplete="name" required></label>
      <label class="f"><span>Email *</span><input type="email" data-c="email" autocomplete="email" required></label>
      <label class="f"><span>Téléphone</span><input type="tel" data-c="phone" autocomplete="tel"></label>
      <label class="f"><span>Code postal</span><input type="text" data-c="zip" autocomplete="postal-code"></label>
      <label class="f"><span>Ville</span><input type="text" data-c="city" autocomplete="address-level2"></label>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    </div></div>
    <div class="sec"><h2><span class="n">2</span>Votre projet</h2><div class="grid g3">
      <label class="f" style="grid-column:span 3"><span>En quelques mots</span><input type="text" id="subject" placeholder="Ex. : Maillots et sweats pour la saison, tenues pour un tournoi, tenues de travail…"></label>
      <label class="f"><span>Pour quand ?</span><input type="date" id="deadline"></label>
      <label class="f"><span>Budget indicatif</span><select id="budget"><option value="">Je ne sais pas</option><option>Moins de 300 €</option><option>300 à 800 €</option><option>800 à 2 000 €</option><option>2 000 à 5 000 €</option><option>Plus de 5 000 €</option></select></label>
      <label class="f"><span>Événement (facultatif)</span><input type="text" id="event" placeholder="Tournoi, salon, mariage…"></label>
    </div></div>
    <div class="sec"><h2><span class="n">3</span>Articles et marquages</h2><div id="items"></div>
      <button type="button" class="btn" id="addItem" style="margin-top:12px">${icon("plus")} Ajouter un autre article</button></div>
    <div class="sec"><h2><span class="n">4</span>Vos visuels</h2>
      <div class="drop" id="drop">${icon("upload")}<div style="margin-top:6px"><b>Ajoutez votre logo ou visuel</b> (PNG, JPG, PDF — vectoriel idéal)<br><small>glissez-déposez ou cliquez · 15 Mo max par fichier</small></div></div>
      <div class="row" id="files" style="margin-top:10px"></div>
      <label class="f" style="margin-top:14px"><span>Précisions (couleurs Pantone, textes, noms et numéros…)</span><textarea id="message" rows="4"></textarea></label></div>
    <div class="sec">
      <label class="check" style="align-items:flex-start"><input type="checkbox" id="consent"> <span style="font-size:13px">J'accepte que ${h(co.name || "l'atelier")} utilise ces informations pour établir mon devis et me recontacter à ce sujet. *</span></label>
      <div class="row" style="margin-top:16px;justify-content:space-between"><small class="muted">Devis gratuit et sans engagement · Réponse rapide${co.phone ? ` · ${h(co.phone)}` : ""}</small>
        <button class="btn primary lg" id="send" type="submit">${icon("send")} Envoyer ma demande</button></div>
    </div>
  </form></div>`;
  drawItems(); drawFiles();
  $("#addItem").onclick = () => { readItems(); F.items.push(newItem()); drawItems(); };
  bindDrop($("#drop"), async files => {
    for (const f of files) {
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} : fichier trop lourd (max 15 Mo)`);
        toast(`Envoi de ${f.name}…`);
        const r = await call("POST", "/form/upload", { dataUrl: await shrinkImage(await readAsDataURL(f)), name: f.name });
        F.files.push(r); drawFiles();
      } catch (e) { fail(e); }
    }
  }, "image/*,application/pdf");
  $("#f").onsubmit = submit;
}

function drawItems() {
  const cats = M.categories;
  $("#items").innerHTML = F.items.map((it, i) => {
    const models = M.catalog.filter(a => !it.product || a.category === it.product);
    const sizes = it.kids ? KIDS : SIZES;
    return `<div class="item" data-i="${i}">${F.items.length > 1 ? `<button type="button" class="btn sm ghost icon rm" data-rm="${i}">${icon("x", "sm")}</button>` : ""}
      <div class="grid g3">
        <label class="f"><span>Type d'article</span><select data-k="product"><option value="">Choisir…</option>${cats.map(c => `<option ${c === it.product ? "selected" : ""}>${h(c)}</option>`).join("")}<option value="Autre" ${it.product === "Autre" ? "selected" : ""}>Autre</option></select></label>
        <label class="f"><span>Modèle (facultatif)</span><select data-k="articleId"><option value="">Conseillez-moi</option>${models.map(a => `<option value="${h(a.id)}" ${a.id === it.articleId ? "selected" : ""}>${h(a.name)}${a.brand ? ` — ${h(a.brand)}` : ""}</option>`).join("")}</select></label>
        <label class="f"><span>Couleur du textile</span><input type="text" data-k="color" value="${h(it.color)}" placeholder="Noir, marine…" list="colors${i}"><datalist id="colors${i}">${(M.catalog.find(a => a.id === it.articleId)?.colors || []).map(c => `<option value="${h(c)}">`).join("")}</datalist></label>
      </div>
      <div style="margin-top:12px"><div class="section-lbl">Quantités par taille <label class="check" style="text-transform:none;letter-spacing:0;font-weight:500"><input type="checkbox" data-kids ${it.kids ? "checked" : ""}> tailles enfant</label></div>
        <div class="sizes">${sizes.map(s => `<label class="size-cell"><span>${h(s)}</span><input type="number" min="0" inputmode="numeric" data-size="${h(s)}" value="${it.sizes[s] || ""}" placeholder="0"></label>`).join("")}
        <label class="size-cell" style="width:120px"><span>ou total</span><input type="number" min="0" data-k="quantity" value="${h(it.quantity)}" placeholder="Qté"></label></div></div>
      <div style="margin-top:12px"><div class="section-lbl">Marquages (emplacement et taille souhaitée)</div>
        ${it.positions.map((p, j) => `<div class="pos" data-j="${j}">
          <label class="f"><span>Emplacement</span><input type="text" data-p="position" value="${h(p.position)}" list="posl"></label>
          <label class="f"><span>Largeur (cm)</span><input type="number" step="0.5" min="0" data-p="w" value="${h(p.w ?? "")}"></label>
          <label class="f"><span>Hauteur (cm)</span><input type="number" step="0.5" min="0" data-p="h" value="${h(p.h ?? "")}"></label>
          <label class="f"><span>Technique</span><select data-p="technique"><option value="">Conseillez-moi</option>${M.techniques.map(t => `<option value="${h(t.id)}" ${t.id === p.technique ? "selected" : ""}>${h(t.name)}</option>`).join("")}</select></label>
          <label class="f"><span>Couleurs</span><input type="number" min="1" max="12" data-p="colors" value="${h(p.colors || 1)}"></label>
          <button type="button" class="btn sm ghost icon" data-prm="${j}" title="Retirer">${icon("x", "sm")}</button></div>`).join("")}
        <div class="presets"><small class="muted" style="align-self:center">Ajouter :</small>${PRESETS.map(([l, w, hh]) => `<button type="button" data-preset="${h(l)}|${w}|${hh}">${h(l)} ~${w}×${hh} cm</button>`).join("")}</div></div>
      <label class="f" style="margin-top:12px"><span>Remarques sur cet article</span><input type="text" data-k="notes" value="${h(it.notes)}" placeholder="Ex. : prénoms différents au dos, numéros 1 à 20…"></label>
    </div>`;
  }).join("") + `<datalist id="posl">${(M.positions || []).map(p => `<option value="${h(p)}">`).join("")}</datalist>`;
  $$("[data-rm]").forEach(b => b.onclick = () => { readItems(); F.items.splice(+b.dataset.rm, 1); drawItems(); });
  $$(".item").forEach(el => {
    const it = F.items[el.dataset.i];
    $$("[data-prm]", el).forEach(b => b.onclick = () => { readItems(); it.positions.splice(+b.dataset.prm, 1); drawItems(); });
    $$("[data-preset]", el).forEach(b => b.onclick = () => { readItems(); const [l, w, hh] = b.dataset.preset.split("|"); it.positions.push({ position: l, w: +w, h: +hh, technique: "", colors: 1 }); drawItems(); });
    $("[data-kids]", el).onchange = e => { readItems(); it.kids = e.target.checked; it.sizes = {}; drawItems(); };
    $('[data-k="product"]', el).onchange = () => { readItems(); it.articleId = ""; drawItems(); };
    $('[data-k="articleId"]', el).onchange = () => { readItems(); drawItems(); };
    $$("[data-size]", el).forEach(i => i.oninput = () => {
      readItems();
      const sum = Object.values(it.sizes).reduce((s, n) => s + n, 0);
      if (sum) $('[data-k="quantity"]', el).value = sum;
    });
  });
}

function readItems() {
  $$(".item").forEach(el => {
    const it = F.items[el.dataset.i];
    for (const i of $$("[data-k]", el)) it[i.dataset.k] = i.value;
    it.sizes = {};
    for (const i of $$("[data-size]", el)) { const n = parseInt(i.value, 10); if (n > 0) it.sizes[i.dataset.size] = n; }
    it.positions = $$(".pos", el).map(p => Object.fromEntries($$("[data-p]", p).map(i => [i.dataset.p, i.type === "number" ? (i.value === "" ? null : Number(i.value)) : i.value])));
  });
}

function drawFiles() {
  $("#files").innerHTML = F.files.map((f, i) => `<span class="chip">${icon(f.type === "pdf" ? "file" : "image", "sm")} ${h(f.name)} <button type="button" class="link-btn" data-frm="${i}" style="color:inherit">${icon("x", "sm")}</button></span>`).join("");
  $$("[data-frm]").forEach(b => b.onclick = () => { F.files.splice(+b.dataset.frm, 1); drawFiles(); });
}

async function submit(e) {
  e.preventDefault();
  readItems();
  const contact = Object.fromEntries($$("[data-c]").map(i => [i.dataset.c, i.value.trim()]));
  if (!contact.contact) return fail("Indiquez votre nom.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return fail("Indiquez une adresse email valide.");
  if (!$("#consent").checked) return fail("Merci de cocher la case d'accord pour que nous puissions vous répondre.");
  const items = F.items.map(it => {
    const sum = Object.values(it.sizes).reduce((s, n) => s + n, 0);
    const product = it.product === "Autre" ? (it.notes || "Autre") : it.product || M.catalog.find(a => a.id === it.articleId)?.category || "";
    return { product, articleId: it.articleId, color: it.color, quantity: sum || parseInt(it.quantity, 10) || 0, sizes: Object.entries(it.sizes).map(([s, n]) => `${s}:${n}`).join(", "), notes: it.notes,
      positions: it.positions.filter(p => p.position || p.w) };
  }).filter(it => it.product || it.quantity || it.positions.length);
  if (!items.some(it => it.quantity) && !$("#message").value.trim()) return fail("Indiquez au moins une quantité ou décrivez votre besoin.");
  const btn = $("#send");
  btn.disabled = true;
  try {
    const r = await call("POST", "/request", {
      contact, items, files: F.files, subject: $("#subject").value, budget: $("#budget").value, event: $("#event").value,
      deadline: $("#deadline").value ? new Date($("#deadline").value + "T12:00:00").getTime() : null, message: $("#message").value,
      consent: true, website: $('[name="website"]').value,
    });
    root.querySelector(".form").innerHTML = `<div class="ok"><div class="big">${icon("check")}</div><h1>Merci, votre demande est envoyée !</h1>
      <p class="muted">Référence <b>${h(r.number || "")}</b>. Nous revenons vers vous très vite avec un devis détaillé${contact.email ? ` à l'adresse ${h(contact.email)}` : ""}.</p>
      <p class="muted">Vous pourrez ensuite accepter le devis et valider votre BAT en ligne.</p></div>`;
    scrollTo({ top: 0, behavior: "smooth" });
    parent?.postMessage?.({ type: "devis-request-sent" }, "*");
  } catch (err) { fail(err); btn.disabled = false; }
}

(async () => {
  try { M = await call("GET", "/form"); F.items = [newItem()]; render(); }
  catch (e) { root.innerHTML = `<div class="empty">${h(e.message)}</div>`; }
})();
