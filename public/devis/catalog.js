/* Références (catalogue textile + import CSV), techniques de marquage (grilles), simulateur de prix. */
import { S, api, h, $, $$, icon, badge, toast, fail, modal, confirmBox, fmtEUR, uid, num, clone, uploadFile, pickFiles, readAsText, parseCSV, toCSV, parseNum, download, r2 } from "./ui.js";
import { breakTable, UNIVERSES } from "./pricing.js";
import { newQuote } from "./app.js";
import { lineFromArticle, articlePicker } from "./editor.js";
import { supplierPricesModal } from "./achats.js";

const salePrice = a => a.salePrice ?? r2(a.cost * (a.coef ?? S.settings.defaultCoef));
const list = s => String(s || "").split(/[|,;/]/).map(x => x.trim()).filter(Boolean);

/* ================================================================
   RÉFÉRENCES
   ================================================================ */
const sel = new Set();
let refUni = "textile";
const uniOf = a => a.universe || "textile";
export function renderCatalog(main) {
  const cats = [...new Set(S.catalog.filter(a => uniOf(a) === refUni).map(a => a.category).filter(Boolean))].sort();
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Références</h1><p>${S.catalog.length} articles · prix de vente = prix d'achat × coefficient (${S.settings.defaultCoef} par défaut)</p></div>
    <button class="btn" id="exp">${icon("download")} Exporter</button>
    <button class="btn" id="prices">${icon("trend")} Tarif fournisseur</button>
    <button class="btn" id="imp">${icon("upload")} Importer (CSV / Excel)</button>
    <button class="btn primary" id="add">${icon("plus")} Nouvelle référence</button></div>
  <div class="seg" id="ru" style="margin-bottom:16px">${[["textile", "Textile"], ["objet", "Objets personnalisés"]].map(([k, l]) => `<button data-u="${k}" class="${refUni === k ? "on" : ""}">${l} (${S.catalog.filter(a => uniOf(a) === k).length})</button>`).join("")}</div>
  <p class="hint" style="margin-top:-6px">Les produits imprimés (flyers, cartes, affiches…) se règlent dans <a href="#/techniques">Marquages & tarifs › Print</a>.</p>
  <div class="card"><div class="toolbar">
    <div class="search">${icon("search", "sm")}<input type="search" id="rs" placeholder="Référence, nom, marque…"></div>
    <select id="rc" style="width:180px"><option value="">Toutes catégories</option>${cats.map(c => `<option>${h(c)}</option>`).join("")}</select>
    <span class="spacer"></span>
    <div id="bulk" class="row hidden"><small class="muted" id="bulkN"></small>
      <button class="btn sm" id="bCoef">Coefficient…</button><button class="btn sm" id="bCost">Hausse prix d'achat…</button><button class="btn sm danger" id="bDel">${icon("trash", "sm")}</button></div>
  </div><div id="rt"></div></div>`;
  const draw = () => {
    const s = $("#rs").value.toLowerCase(), c = $("#rc").value;
    const items = S.catalog.filter(a => uniOf(a) === refUni && (!c || a.category === c) && (!s || [a.ref, a.name, a.brand, a.category].join(" ").toLowerCase().includes(s)));
    $("#rt").innerHTML = items.length ? `<div class="table-wrap"><table class="t"><thead><tr>
      <th style="width:36px"><input type="checkbox" id="all"></th><th></th><th>Référence</th><th>Catégorie</th><th>Coloris</th><th>Tailles</th>
      <th class="r">Achat HT</th><th class="r">Coef</th><th class="r">Vente HT</th></tr></thead><tbody>
      ${items.map(a => `<tr class="click" data-a="${a.id}">
        <td><input type="checkbox" data-sel="${a.id}" ${sel.has(a.id) ? "checked" : ""}></td>
        <td style="width:52px"><div class="thumb">${a.image ? `<img src="${h(a.image)}">` : icon("shirt", "sm")}</div></td>
        <td><b>${h(a.name)}</b><br><small>${h([a.ref, a.brand].filter(Boolean).join(" · "))}</small></td>
        <td>${a.category ? badge(a.category, "neutral", true) : ""}</td>
        <td><small>${h((a.colors || []).slice(0, 3).join(", "))}${(a.colors || []).length > 3 ? ` +${a.colors.length - 3}` : ""}</small></td>
        <td><small>${h((a.sizes || []).join(" "))}</small></td>
        <td class="r num">${fmtEUR(a.cost)}</td>
        <td class="r num">${a.salePrice != null ? `<small class="muted">fixe</small>` : `${a.coef ?? `<span class="faint">${S.settings.defaultCoef}</span>`}`}</td>
        <td class="r num"><b>${fmtEUR(salePrice(a))}</b></td></tr>`).join("")}
      </tbody></table></div>`
      : `<div class="empty"><div class="ico">${icon("shirt")}</div><b>Aucune référence</b><p>Importez votre catalogue fournisseur en CSV ou ajoutez vos articles un par un.</p></div>`;
    $$("[data-a]").forEach(r => r.onclick = e => { if (!e.target.closest("input")) articleModal(S.catalog.find(a => a.id === r.dataset.a), draw); });
    $$("[data-sel]").forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); bulkBar(); });
    const all = $("#all");
    if (all) all.onchange = () => { items.forEach(a => all.checked ? sel.add(a.id) : sel.delete(a.id)); draw(); bulkBar(); };
  };
  const bulkBar = () => { $("#bulk").classList.toggle("hidden", !sel.size); $("#bulkN").textContent = `${sel.size} sélectionnée(s)`; };
  const bulkSave = async fn => {
    S.catalog = S.catalog.map(a => sel.has(a.id) ? fn({ ...a }) : a);
    try { S.catalog = await api("PUT", "/catalog", S.catalog); toast("Références mises à jour"); draw(); } catch (e) { fail(e); }
  };
  $("#bCoef").onclick = () => {
    const v = prompt("Nouveau coefficient pour la sélection (vide = coefficient par défaut) :");
    if (v === null) return;
    bulkSave(a => ({ ...a, coef: num(v.replace(",", ".")), salePrice: null }));
  };
  $("#bCost").onclick = () => {
    const v = num(prompt("Hausse (ou baisse) des prix d'achat en % (ex. 4.5 ou -3) :")?.replace(",", "."));
    if (v === null) return;
    bulkSave(a => ({ ...a, cost: r2(a.cost * (1 + v / 100)) }));
  };
  $("#bDel").onclick = async () => {
    if (!(await confirmBox("Supprimer les références sélectionnées ?", `${sel.size} référence(s) seront supprimées. Les devis existants ne sont pas affectés.`, { danger: true, label: "Supprimer" }))) return;
    S.catalog = S.catalog.filter(a => !sel.has(a.id)); sel.clear(); bulkBar();
    try { S.catalog = await api("PUT", "/catalog", S.catalog); draw(); } catch (e) { fail(e); }
  };
  $("#rs").oninput = draw; $("#rc").onchange = draw;
  $("#add").onclick = () => articleModal(null, () => renderCatalog(main));
  $("#prices").onclick = () => supplierPricesModal(() => renderCatalog(main));
  $$("#ru button").forEach(b => b.onclick = () => { refUni = b.dataset.u; sel.clear(); renderCatalog(main); });
  $("#imp").onclick = () => importModal(() => renderCatalog(main));
  $("#exp").onclick = () => download(`references-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([
    ["reference", "nom", "marque", "categorie", "prix_achat", "coef", "prix_vente", "couleurs", "tailles", "surcharges_tailles", "image"],
    ...S.catalog.map(a => [a.ref, a.name, a.brand, a.category, String(a.cost).replace(".", ","), a.coef ?? "", a.salePrice ?? "", (a.colors || []).join("|"), (a.sizes || []).join("|"),
      Object.entries(a.sizeSurcharges || {}).map(([k, v]) => `${k}:${v}`).join("|"), a.image]),
  ]), "text/csv");
  draw(); bulkBar();
}

function articleModal(a, onSaved) {
  const isNew = !a;
  a = a ? clone(a) : { ref: "", name: "", brand: "", category: "", cost: 0, coef: null, salePrice: null, colors: [], sizes: refUni === "objet" ? ["Unique"] : ["S", "M", "L", "XL"], sizeSurcharges: {}, image: "", notes: "", universe: refUni };
  const m = modal({
    title: isNew ? "Nouvelle référence" : a.name, size: "wide",
    body: `<div class="row" style="align-items:flex-start;gap:18px;flex-wrap:nowrap">
      <div style="flex:none;text-align:center"><div class="thumb" id="img" style="width:120px;height:120px">${a.image ? `<img src="${h(a.image)}">` : icon("image")}</div>
        <button class="btn sm" id="imgBtn" style="margin-top:8px">${icon("upload", "sm")} Photo</button></div>
      <div class="grid g2" style="flex:1">
        <label class="f"><span>Référence fournisseur</span><input type="text" data-k="ref" value="${h(a.ref)}"></label>
        <label class="f"><span>Marque</span><input type="text" data-k="brand" value="${h(a.brand)}"></label>
        <label class="f" style="grid-column:span 2"><span>Désignation</span><input type="text" data-k="name" value="${h(a.name)}"></label>
        <label class="f"><span>Univers</span><select data-k="universe"><option value="textile" ${uniOf(a) === "textile" ? "selected" : ""}>Textile</option><option value="objet" ${uniOf(a) === "objet" ? "selected" : ""}>Objet personnalisé</option></select></label>
        <label class="f"><span>Catégorie</span><input type="text" data-k="category" value="${h(a.category)}" list="cats"><datalist id="cats">${[...new Set(S.catalog.map(x => x.category).filter(Boolean))].map(c => `<option value="${h(c)}">`).join("")}</datalist></label>
        <label class="f"><span>Prix d'achat HT</span><div class="input-group"><input type="number" step="0.01" data-k="cost" value="${h(a.cost)}"><span class="addon">€</span></div></label>
        <label class="f"><span>Coefficient</span><div class="input-group"><input type="number" step="0.05" data-k="coef" value="${h(a.coef ?? "")}" placeholder="${h(S.settings.defaultCoef)} (défaut)"><span class="addon">×</span></div></label>
        <label class="f"><span>ou prix de vente fixe HT</span><div class="input-group"><input type="number" step="0.01" data-k="salePrice" value="${h(a.salePrice ?? "")}" placeholder="—"><span class="addon">€</span></div></label>
      </div></div>
      <div class="margin-box" id="pv"></div>
      <div class="grid g2" style="margin-top:14px">
        <label class="f"><span>Coloris disponibles (séparés par des virgules)</span><textarea data-k="colors" rows="2">${h((a.colors || []).join(", "))}</textarea></label>
        <label class="f"><span>Tailles (séparées par des virgules)</span><textarea data-k="sizes" rows="2">${h((a.sizes || []).join(", "))}</textarea></label>
      </div>
      <div style="margin-top:12px"><div class="section-lbl">Surcoût d'achat par taille (ex. 2XL, 3XL)</div><div class="sizes" id="sur"></div></div>
      <label class="f" style="margin-top:12px"><span>Notes internes</span><input type="text" data-k="notes" value="${h(a.notes)}"></label>`,
    actions: [
      ...(isNew ? [] : [{ label: "Supprimer", cls: "danger", icon: "trash", onClick: async () => {
        if (!(await confirmBox("Supprimer cette référence ?", "Les devis existants ne sont pas affectés."))) return false;
        await api("DELETE", `/catalog/${a.id}`); S.catalog = S.catalog.filter(x => x.id !== a.id); onSaved?.();
      } }]),
      ...(isNew ? [] : [{ label: "Dupliquer", icon: "copy", onClick: async () => {
        const { id, ...rest } = a; const saved = await api("POST", "/catalog", { ...rest, ref: rest.ref + "-copie" });
        S.catalog.push(saved); onSaved?.(); toast("Référence dupliquée");
      } }]),
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async () => {
        read();
        if (!a.name) throw new Error("La désignation est obligatoire.");
        const saved = isNew ? await api("POST", "/catalog", a) : await api("PUT", `/catalog/${a.id}`, a);
        S.catalog = isNew ? [...S.catalog, saved] : S.catalog.map(x => x.id === saved.id ? saved : x);
        toast("Référence enregistrée"); onSaved?.();
      } },
    ],
  });
  const read = () => {
    for (const el of $$("[data-k]", m.el)) {
      const k = el.dataset.k;
      a[k] = ["colors", "sizes"].includes(k) ? list(el.value) : ["cost", "coef", "salePrice"].includes(k) ? num(el.value) : el.value.trim();
    }
    a.cost ??= 0;
    for (const i of $$("[data-sur]", m.el)) { const v = num(i.value); if (v) a.sizeSurcharges[i.dataset.sur] = v; else delete a.sizeSurcharges[i.dataset.sur]; }
  };
  const preview = () => {
    read();
    const sp = salePrice(a), mg = sp ? Math.round((sp - a.cost) / sp * 100) : 0;
    $("#pv", m.el).innerHTML = `<div class="row between"><span>Prix de vente textile HT (avant remise qté)</span><b class="num">${fmtEUR(sp)}</b></div><small class="muted">Marge textile : ${fmtEUR(sp - a.cost)} · ${mg} %</small>`;
    $("#sur", m.el).innerHTML = (a.sizes || []).map(s => `<label class="size-cell"><span>${h(s)}</span><input type="number" step="0.05" data-sur="${h(s)}" value="${h(a.sizeSurcharges?.[s] ?? "")}" placeholder="0"></label>`).join("");
    $$("[data-sur]", m.el).forEach(i => i.oninput = () => { read(); });
  };
  $$("[data-k]", m.el).forEach(i => i.addEventListener("input", () => {
    if (i.dataset.k === "sizes") preview();
    else { read(); const sp = salePrice(a); $("#pv b", m.el).textContent = fmtEUR(sp); $("#pv small", m.el).textContent = `Marge textile : ${fmtEUR(sp - a.cost)} · ${sp ? Math.round((sp - a.cost) / sp * 100) : 0} %`; }
  }));
  $("#imgBtn", m.el).onclick = async () => {
    const [f] = await pickFiles({ accept: "image/*", multiple: false });
    if (!f) return;
    try { const r = await uploadFile(f); a.image = r.url; $("#img", m.el).innerHTML = `<img src="${h(r.url)}">`; } catch (e) { fail(e); }
  };
  preview();
}

/* -------- Import CSV -------- */
const FIELDS = [
  ["ref", "Référence", ["ref", "reference", "référence", "code", "sku", "article"]],
  ["name", "Désignation", ["nom", "name", "designation", "désignation", "libelle", "libellé", "description", "produit"]],
  ["brand", "Marque", ["marque", "brand", "fournisseur", "fabricant"]],
  ["category", "Catégorie", ["categorie", "catégorie", "category", "famille", "type"]],
  ["cost", "Prix d'achat HT", ["prix_achat", "prix achat", "achat", "cost", "prix ht", "pa", "prix", "tarif", "price"]],
  ["coef", "Coefficient", ["coef", "coefficient", "multiplicateur"]],
  ["salePrice", "Prix de vente fixe", ["prix_vente", "prix vente", "pv", "vente", "sale"]],
  ["colors", "Coloris", ["couleurs", "couleur", "coloris", "colors", "color"]],
  ["sizes", "Tailles", ["tailles", "taille", "sizes", "size"]],
  ["sizeSurcharges", "Surcoûts tailles (2XL:0.5|3XL:1)", ["surcharges_tailles", "surcout", "surcoût", "surcharges"]],
  ["image", "URL image", ["image", "photo", "url", "visuel"]],
  ["universe", "Univers (textile / objet)", ["univers", "universe", "gamme"]],
];
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function importModal(onDone) {
  let rows = [], header = [], map = {};
  const m = modal({
    title: "Importer des références", size: "xwide",
    body: `<div class="drop" id="dz">${icon("upload")}<div style="margin-top:6px"><b>Déposez un fichier CSV</b> (export Excel « CSV UTF-8 », séparateur ; ou ,)<br><small>ou cliquez pour parcourir — vous pouvez aussi coller vos lignes ci-dessous</small></div></div>
      <textarea id="paste" rows="3" style="margin-top:10px" placeholder="Ou collez ici des lignes copiées depuis Excel (avec la ligne d'en-têtes)…"></textarea>
      <div id="mapBox"></div>
      <p class="hint">Modèle : <a href="#" id="tpl">télécharger un fichier exemple</a>. Les colonnes sont reconnues automatiquement ; ajustez si besoin.</p>`,
    actions: [{ label: "Annuler" }, { label: "Importer", cls: "primary", icon: "check", onClick: async () => {
      if (!rows.length) throw new Error("Aucune ligne à importer.");
      const mode = $("[name=mode]:checked", m.el)?.value || "merge";
      const items = rows.map(r => {
        const v = k => (map[k] >= 0 ? (r[map[k]] ?? "").trim() : "");
        const sur = {};
        v("sizeSurcharges").split(/[|,]/).forEach(p => { const [s, x] = p.split(":"); if (s && parseNum(x)) sur[s.trim()] = parseNum(x); });
        return {
          ref: v("ref"), name: v("name") || v("ref"), brand: v("brand"), category: v("category"), cost: parseNum(v("cost")) ?? 0,
          coef: parseNum(v("coef")), salePrice: parseNum(v("salePrice")), colors: list(v("colors")), sizes: list(v("sizes")).length ? list(v("sizes")) : ["Unique"],
          universe: /obj|goodie/i.test(v("universe")) ? "objet" : v("universe") ? "textile" : refUni,
          sizeSurcharges: sur, image: v("image"), notes: "",
        };
      }).filter(x => x.name);
      let catalog = mode === "replace" ? [] : clone(S.catalog);
      let added = 0, updated = 0;
      for (const it of items) {
        const ex = it.ref && catalog.find(c => c.ref && c.ref.toLowerCase() === it.ref.toLowerCase());
        if (ex) {
          // mise à jour : on n'écrase que les champs renseignés dans le fichier
          for (const [k, val] of Object.entries(it)) if (val !== "" && val !== null && !(Array.isArray(val) && !val.length) && !(k === "sizeSurcharges" && !Object.keys(val).length)) ex[k] = val;
          updated++;
        } else { catalog.push({ ...it, id: uid("a") }); added++; }
      }
      S.catalog = await api("PUT", "/catalog", catalog);
      toast(`${added} référence(s) ajoutée(s), ${updated} mise(s) à jour`);
      onDone?.();
    } }],
  });
  const load = text => {
    const all = parseCSV(text);
    if (all.length < 2) return fail("Fichier vide ou sans ligne de données.");
    header = all[0]; rows = all.slice(1);
    map = {};
    for (const [k, , aliases] of FIELDS) {
      let idx = header.findIndex(hd => aliases.some(al => norm(hd) === norm(al)));
      if (idx < 0) idx = header.findIndex(hd => aliases.some(al => norm(hd).includes(norm(al))));
      map[k] = idx;
    }
    drawMap();
  };
  const drawMap = () => {
    $("#mapBox", m.el).innerHTML = `<div class="grid g4" style="margin-top:14px">${FIELDS.map(([k, l]) => `<label class="f"><span>${l}</span><select class="sm" data-map="${k}"><option value="-1">— ignorer —</option>${header.map((hd, i) => `<option value="${i}" ${map[k] === i ? "selected" : ""}>${h(hd)}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="row" style="margin-top:12px"><label class="check"><input type="radio" name="mode" value="merge" checked> Ajouter / mettre à jour (par référence)</label><label class="check"><input type="radio" name="mode" value="replace"> Remplacer tout le catalogue</label></div>
      <div class="section-lbl" style="margin-top:14px">Aperçu (${rows.length} lignes)</div>
      <div class="table-wrap" style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:10px"><table class="t"><thead><tr>${FIELDS.filter(([k]) => map[k] >= 0).map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0, 8).map(r => `<tr>${FIELDS.filter(([k]) => map[k] >= 0).map(([k]) => `<td><small>${h(r[map[k]])}</small></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    $$("[data-map]", m.el).forEach(s => s.onchange = () => { map[s.dataset.map] = +s.value; drawMap(); });
  };
  const dz = $("#dz", m.el);
  dz.onclick = async () => { const [f] = await pickFiles({ accept: ".csv,.txt,text/csv", multiple: false }); if (f) load(await readAsText(f)); };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = async e => { e.preventDefault(); dz.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) load(await readAsText(f)); };
  $("#paste", m.el).oninput = e => { if (e.target.value.trim()) load(e.target.value); };
  $("#tpl", m.el).onclick = e => {
    e.preventDefault();
    download("modele-references.csv", toCSV([
      ["reference", "nom", "marque", "categorie", "prix_achat", "coef", "prix_vente", "couleurs", "tailles", "surcharges_tailles", "image"],
      ["K356", "T-shirt col rond homme", "Kariban", "T-shirt", "2,35", "", "", "Blanc|Noir|Navy", "S|M|L|XL|2XL|3XL", "2XL:0.4|3XL:0.8", ""],
      ["B15", "Casquette 5 panneaux", "Beechfield", "Accessoire", "2,60", "2", "", "Noir|Navy", "Unique", "", ""],
    ]), "text/csv");
  };
}

/* ================================================================
   TECHNIQUES DE MARQUAGE
   ================================================================ */
let techUni = "textile";
export function renderTechniques(main) {
  const list = S.techniques.filter(t => (t.universe || "textile") === techUni);
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Marquages & tarifs</h1><p>Techniques de personnalisation (textile, objets) et produits imprimés, avec leurs formats, options et grilles dégressives.</p></div>
    <button class="btn primary" id="add">${icon("plus")} ${techUni === "print" ? "Nouveau produit imprimé" : "Nouvelle technique"}</button></div>
    <div class="seg" id="tu" style="margin-bottom:16px">${Object.entries(UNIVERSES).map(([k, l]) => `<button data-u="${k}" class="${techUni === k ? "on" : ""}">${l} (${S.techniques.filter(t => (t.universe || "textile") === k).length})</button>`).join("")}</div>
    <div class="grid g2">${list.map(t => `<div class="card tech-card" data-t="${t.id}">
      <div class="ic" style="background:${h(t.color)}">${icon("brush")}</div>
      <div style="flex:1;min-width:0"><div class="row between"><h3>${h(t.name)}</h3>${t.colorsEnabled ? badge("Prix selon nb de couleurs", "info", true) : ""}</div>
        <p class="muted" style="margin:4px 0 8px">${h(t.description || "")}</p>
        <div class="row" style="gap:6px">${(t.formats || []).map(f => `<span class="chip">${h(f.label)}</span>`).join("")}</div>
        ${(t.options || []).length ? `<div class="row" style="gap:6px;margin-top:6px">${t.options.map(o => `<span class="chip gray">${h(o.label)}</span>`).join("")}</div>` : ""}
        <small class="muted" style="display:block;margin-top:8px">Paliers : ${(t.breaks || []).join(" · ")} ${t.universe === "print" ? "ex." : "pcs"}${t.setupFee || t.setupPerColor ? ` · ${h(t.setupLabel || "Frais")} : ${t.setupFee ? fmtEUR(t.setupFee) : ""}${t.setupPerColor ? ` ${fmtEUR(t.setupPerColor)}/couleur` : ""}` : " · sans frais fixes"}${t.minQty > 1 ? ` · min. ${t.minQty} pcs` : ""}</small>
      </div></div>`).join("") || `<div class="card empty">Rien pour l'instant.</div>`}</div>`;
  $$("#tu button").forEach(b => b.onclick = () => { techUni = b.dataset.u; renderTechniques(main); });
  $$("[data-t]").forEach(c => c.onclick = () => techniqueEditor(S.techniques.find(t => t.id === c.dataset.t), () => renderTechniques(main)));
  $("#add").onclick = () => techniqueEditor(null, () => renderTechniques(main));
}

function techniqueEditor(t, onSaved) {
  const isNew = !t;
  t = t ? clone(t) : {
    name: "", color: "#0891b2", colorsEnabled: false, maxColors: 6, minQty: 1, setupFee: 0, setupPerColor: 0, setupLabel: "Frais techniques", costPct: 40, description: "",
    formats: [{ id: uid("fmt"), label: "Petit (≤ 10×10 cm)", w: 10, h: 10 }, { id: uid("fmt"), label: "Grand (≤ 30×40 cm)", w: 30, h: 40 }],
    breaks: [1, 10, 25, 50, 100], prices: {}, extraColorPrices: [], universe: techUni, options: [],
  };
  t.prices ||= {}; t.extraColorPrices ||= []; t.options ||= []; t.universe ||= "textile";
  const m = modal({
    title: isNew ? "Nouvelle technique" : t.name, size: "xwide",
    body: `<div class="grid g4">
      <label class="f" style="grid-column:span 2"><span>Nom</span><input type="text" id="tName" value="${h(t.name)}" placeholder="Ex. : Sublimation, Gravure laser…"></label>
      <label class="f"><span>Univers</span><select id="tUni">${Object.entries(UNIVERSES).map(([k, l]) => `<option value="${k}" ${t.universe === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f"><span>Couleur repère</span><input type="color" id="tColor" value="${h(t.color)}" style="height:36px;padding:3px"></label>
      <label class="f"><span>Quantité minimum conseillée</span><input type="number" id="tMin" value="${h(t.minQty)}"></label>
      <label class="f" style="grid-column:span 4"><span>Description (pour vous)</span><input type="text" id="tDesc" value="${h(t.description)}"></label>
      <label class="f"><span>Libellé des frais fixes</span><input type="text" id="tSetupLbl" value="${h(t.setupLabel)}" placeholder="Écrans, Digitalisation…"></label>
      <label class="f"><span>Frais fixes par visuel</span><div class="input-group"><input type="number" step="0.01" id="tSetup" value="${h(t.setupFee)}"><span class="addon">€</span></div></label>
      <label class="f"><span>Coût de revient estimé</span><div class="input-group"><input type="number" id="tCost" value="${h(t.costPct)}"><span class="addon">% du PV</span></div><div class="hint">Sert au calcul de marge.</div></label>
      <div></div>
      <label class="check" style="grid-column:span 2"><input type="checkbox" id="tColors" ${t.colorsEnabled ? "checked" : ""}> Le prix dépend du nombre de couleurs (sérigraphie, flex…)</label>
      <label class="f colors-only"><span>Frais fixes par couleur</span><div class="input-group"><input type="number" step="0.01" id="tSetupColor" value="${h(t.setupPerColor)}"><span class="addon">€</span></div></label>
      <label class="f colors-only"><span>Nombre max. de couleurs</span><input type="number" id="tMaxC" value="${h(t.maxColors)}"></label>
    </div>
    <div class="row between" style="margin:20px 0 8px"><h3>Grille de prix unitaires HT (par pièce)</h3>
      <div class="row"><button class="btn sm" id="addBreak">${icon("plus", "sm")} Palier</button><button class="btn sm" id="addFmt">${icon("plus", "sm")} Format</button><button class="btn sm" id="pct">± % sur la grille</button></div></div>
    <p class="hint" style="margin-top:0">Lignes = formats (avec dimensions max. pour la détection automatique). Colonnes = paliers de quantité (« à partir de »).</p>
    <div class="table-wrap" id="grid"></div>
    <div class="row between" style="margin:20px 0 8px"><h3>Options</h3><button class="btn sm" id="addOpt">${icon("plus", "sm")} Option</button></div>
    <p class="hint" style="margin-top:0">Papier, recto-verso, finition, création graphique… Les options d'un même <b>groupe</b> s'excluent (le client en choisit une). Effet : <b>%</b> du prix unitaire, <b>€/unité</b> ajouté à chaque pièce, ou <b>€ fixe</b> une fois par visuel.</p>
    <div id="opts"></div>`,
    actions: [
      ...(isNew ? [] : [{ label: "Supprimer", cls: "danger", icon: "trash", onClick: async () => {
        if (!(await confirmBox("Supprimer cette technique ?", "Les devis existants gardent leur grille figée."))) return false;
        await api("DELETE", `/techniques/${t.id}`); S.techniques = S.techniques.filter(x => x.id !== t.id); onSaved?.();
      } }]),
      ...(isNew ? [] : [{ label: "Dupliquer", icon: "copy", onClick: async () => {
        const { id, ...rest } = clone(t); const saved = await api("POST", "/techniques", { ...rest, name: rest.name + " (copie)" });
        S.techniques.push(saved); onSaved?.();
      } }]),
      { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: async () => {
        readHead();
        if (!t.name) throw new Error("Le nom est obligatoire.");
        if (!t.formats.length) throw new Error("Ajoutez au moins un format.");
        const order = t.breaks.map((b, i) => [b, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        t.breaks = order.map(i => t.breaks[i]);
        for (const f of t.formats) t.prices[f.id] = order.map(i => t.prices[f.id]?.[i] ?? 0);
        t.extraColorPrices = order.map(i => t.extraColorPrices[i] ?? 0);
        for (const k of Object.keys(t.prices)) if (!t.formats.some(f => f.id === k)) delete t.prices[k];
        const saved = isNew ? await api("POST", "/techniques", t) : await api("PUT", `/techniques/${t.id}`, t);
        S.techniques = isNew ? [...S.techniques, saved] : S.techniques.map(x => x.id === saved.id ? saved : x);
        toast("Grille enregistrée — les nouveaux devis l'utilisent"); onSaved?.();
      } },
    ],
  });
  const readHead = () => {
    t.name = $("#tName", m.el).value.trim(); t.color = $("#tColor", m.el).value; t.minQty = num($("#tMin", m.el).value) ?? 1;
    t.description = $("#tDesc", m.el).value; t.setupLabel = $("#tSetupLbl", m.el).value; t.setupFee = num($("#tSetup", m.el).value) ?? 0;
    t.costPct = num($("#tCost", m.el).value) ?? 40; t.colorsEnabled = $("#tColors", m.el).checked;
    t.setupPerColor = num($("#tSetupColor", m.el).value) ?? 0; t.maxColors = num($("#tMaxC", m.el).value) ?? 0;
    t.universe = $("#tUni", m.el).value;
    t.options = t.options.filter(o => o.label.trim());
  };
  const drawOpts = () => {
    $("#opts", m.el).innerHTML = t.options.map((o, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap">
      <input class="sm" data-o="${i}" data-f="label" value="${h(o.label)}" placeholder="Libellé (ex. Papier 170 g)">
      <input class="sm" style="width:140px;flex:none" data-o="${i}" data-f="group" value="${h(o.group || "")}" placeholder="Groupe (ex. Papier)">
      <select class="sm" style="width:120px;flex:none" data-o="${i}" data-f="type"><option value="pct" ${o.type === "pct" ? "selected" : ""}>+ %</option><option value="unit" ${o.type === "unit" ? "selected" : ""}>+ €/unité</option><option value="fixed" ${o.type === "fixed" ? "selected" : ""}>+ € fixe</option></select>
      <input type="number" class="sm" style="width:90px;flex:none" step="0.01" data-o="${i}" data-f="value" value="${h(o.value)}">
      <button class="btn sm ghost icon" data-ord="${i}">${icon("trash", "sm")}</button></div>`).join("") || `<small class="muted">Aucune option.</small>`;
    $$("[data-o]", m.el).forEach(el => el.oninput = el.onchange = () => { const o = t.options[el.dataset.o]; o[el.dataset.f] = el.dataset.f === "value" ? num(el.value) ?? 0 : el.value; });
    $$("[data-ord]", m.el).forEach(b => b.onclick = () => { t.options.splice(+b.dataset.ord, 1); drawOpts(); });
  };
  $("#addOpt", m.el).onclick = () => { t.options.push({ id: uid("o"), label: "", group: "", type: "pct", value: 0 }); drawOpts(); };
  drawOpts();
  const toggleColors = () => $$(".colors-only", m.el).forEach(e => e.style.opacity = $("#tColors", m.el).checked ? 1 : .4);
  $("#tColors", m.el).onchange = () => { toggleColors(); readHead(); drawGrid(); };
  toggleColors();
  const drawGrid = () => {
    $("#grid", m.el).innerHTML = `<table class="matrix"><thead><tr><th style="text-align:left">Format</th><th>L max (cm)</th><th>H max (cm)</th>
      ${t.breaks.map((b, i) => `<th><div class="row" style="gap:2px;flex-wrap:nowrap;justify-content:center">≥<input type="number" class="sm" style="width:64px;text-align:center" data-break="${i}" value="${b}"><button class="btn sm ghost icon" data-rb="${i}" title="Supprimer ce palier">${icon("x", "sm")}</button></div></th>`).join("")}<th></th></tr></thead><tbody>
      ${t.formats.map((f, fi) => `<tr><td><input class="sm" data-fl="${fi}" value="${h(f.label)}"></td>
        <td><input type="number" class="sm" step="0.1" style="min-width:60px" data-fw="${fi}" value="${h(f.w)}"></td><td><input type="number" class="sm" step="0.1" style="min-width:60px" data-fh="${fi}" value="${h(f.h)}"></td>
        ${t.breaks.map((_, bi) => `<td><input type="number" class="sm" step="0.01" data-p="${f.id}" data-bi="${bi}" value="${h(t.prices[f.id]?.[bi] ?? "")}"></td>`).join("")}
        <td><button class="btn sm ghost icon" data-rf="${fi}">${icon("trash", "sm")}</button></td></tr>`).join("")}
      ${t.colorsEnabled ? `<tr><td colspan="3"><b>+ par couleur supplémentaire</b></td>${t.breaks.map((_, bi) => `<td><input type="number" class="sm" step="0.01" data-xc="${bi}" value="${h(t.extraColorPrices[bi] ?? "")}"></td>`).join("")}<td></td></tr>` : ""}
      </tbody></table>`;
    $$("[data-break]", m.el).forEach(i => i.oninput = () => t.breaks[i.dataset.break] = num(i.value) ?? 1);
    $$("[data-fl]", m.el).forEach(i => i.oninput = () => t.formats[i.dataset.fl].label = i.value);
    $$("[data-fw]", m.el).forEach(i => i.oninput = () => t.formats[i.dataset.fw].w = num(i.value) ?? 0);
    $$("[data-fh]", m.el).forEach(i => i.oninput = () => t.formats[i.dataset.fh].h = num(i.value) ?? 0);
    $$("[data-p]", m.el).forEach(i => i.oninput = () => { (t.prices[i.dataset.p] ||= [])[i.dataset.bi] = num(i.value) ?? 0; });
    $$("[data-xc]", m.el).forEach(i => i.oninput = () => t.extraColorPrices[i.dataset.xc] = num(i.value) ?? 0);
    $$("[data-rb]", m.el).forEach(b => b.onclick = () => {
      const i = +b.dataset.rb;
      if (t.breaks.length < 2) return fail("Au moins un palier est nécessaire.");
      t.breaks.splice(i, 1); t.extraColorPrices.splice(i, 1); Object.values(t.prices).forEach(p => p.splice(i, 1)); drawGrid();
    });
    $$("[data-rf]", m.el).forEach(b => b.onclick = () => { const f = t.formats.splice(+b.dataset.rf, 1)[0]; delete t.prices[f.id]; drawGrid(); });
  };
  $("#addBreak", m.el).onclick = () => { t.breaks.push((t.breaks[t.breaks.length - 1] || 1) * 2); drawGrid(); };
  $("#addFmt", m.el).onclick = () => { t.formats.push({ id: uid("fmt"), label: "Nouveau format", w: 20, h: 20 }); drawGrid(); };
  $("#pct", m.el).onclick = () => {
    const v = num(prompt("Augmenter (ou baisser) toute la grille de … % (ex. 5 ou -3) :")?.replace(",", "."));
    if (v === null) return;
    for (const k of Object.keys(t.prices)) t.prices[k] = t.prices[k].map(p => r2(p * (1 + v / 100)));
    t.extraColorPrices = t.extraColorPrices.map(p => r2(p * (1 + v / 100)));
    drawGrid();
  };
  drawGrid();
}

/* ================================================================
   SIMULATEUR DE PRIX
   ================================================================ */
const SIM = { line: null, qtys: "10, 25, 50, 100, 250, 500" };
export function renderSimulator(main) {
  SIM.line ||= { id: "sim", name: "Article libre", cost: 3, coef: null, availableSizes: ["Unique"], sizes: {}, perso: [], sizeSurcharges: {} };
  const L = SIM.line;
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Simulateur de prix</h1><p>Obtenez instantanément le prix unitaire selon la quantité — idéal au téléphone.</p></div>
    <button class="btn primary" id="toQuote">${icon("file")} Créer un devis</button></div>
  <div class="grid g2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);align-items:start">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Article</h2><button class="btn sm" id="pick">${icon("shirt", "sm")} Choisir une référence</button></div><div class="card-b">
        <div class="row" style="flex-wrap:nowrap;margin-bottom:12px"><div class="thumb">${L.image ? `<img src="${h(L.image)}">` : icon("shirt", "sm")}</div><div><b>${h(L.name)}</b><br><small class="muted">${h([L.ref, L.brand].filter(Boolean).join(" · "))}</small></div></div>
        <div class="grid g3">
          <label class="f"><span>Prix d'achat HT</span><input type="number" step="0.01" id="sCost" value="${h(L.cost ?? "")}" ${L.supplied ? "disabled" : ""}></label>
          <label class="f"><span>Coef.</span><input type="number" step="0.05" id="sCoef" value="${h(L.coef ?? "")}" placeholder="${h(S.settings.defaultCoef)}" ${L.supplied ? "disabled" : ""}></label>
          <label class="check" style="align-self:end;height:36px"><input type="checkbox" id="sSup" ${L.supplied ? "checked" : ""}> Textile fourni</label>
        </div></div></div>
      <div class="card"><div class="card-h"><h2>Marquages</h2><button class="btn sm" id="addP">${icon("plus", "sm")} Ajouter</button></div><div class="card-b" id="sP"></div></div>
      <div class="card"><div class="card-b"><label class="f"><span>Quantités à comparer</span><input type="text" id="sQ" value="${h(SIM.qtys)}"></label></div></div>
    </div>
    <div class="card"><div class="card-h"><h2>Prix dégressifs</h2><small class="muted">HT, par pièce</small></div><div id="sT"></div></div>
  </div>`;
  const drawP = () => {
    $("#sP").innerHTML = L.perso.map((p, i) => {
      const t = S.techniques.find(x => x.id === p.techniqueId);
      return `<div class="perso" style="--pc:${h(t?.color)};grid-template-columns:1.2fr 1fr .9fr .6fr 34px" data-i="${i}">
        <label class="f"><span>Technique</span><select class="sm" data-k="techniqueId">${S.techniques.map(x => `<option value="${h(x.id)}" ${x.id === p.techniqueId ? "selected" : ""}>${h(x.name)}</option>`).join("")}</select></label>
        <label class="f"><span>Format</span><select class="sm" data-k="formatId">${(t?.formats || []).map(f => `<option value="${h(f.id)}" ${f.id === p.formatId ? "selected" : ""}>${h(f.label)}</option>`).join("")}</select></label>
        <label class="f"><span>Emplacement</span><input class="sm" data-k="position" value="${h(p.position)}"></label>
        <label class="f"><span>Coul.</span><input type="number" class="sm" min="1" data-k="colors" value="${h(p.colors)}" ${t?.colorsEnabled ? "" : "disabled"}></label>
        <button class="btn sm ghost icon" data-del>${icon("x", "sm")}</button></div>`;
    }).join("") || `<small class="muted">Aucun marquage.</small>`;
    $$("#sP [data-i]").forEach(row => {
      const p = L.perso[row.dataset.i];
      $$("[data-k]", row).forEach(i => i.onchange = i.oninput = () => {
        p[i.dataset.k] = i.dataset.k === "colors" ? num(i.value) : i.value;
        if (i.dataset.k === "techniqueId") { p.formatId = S.techniques.find(x => x.id === p.techniqueId)?.formats?.[0]?.id || ""; drawP(); }
        drawT();
      });
      $("[data-del]", row).onclick = () => { L.perso.splice(row.dataset.i, 1); drawP(); drawT(); };
    });
  };
  const drawT = () => {
    const qtys = SIM.qtys.split(/[,; ]+/).map(x => parseInt(x, 10)).filter(x => x > 0);
    const rows = breakTable(L, S.techniques, S.settings, qtys);
    $("#sT").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Quantité</th>${L.supplied ? "" : `<th class="r">Textile</th>`}<th class="r">Marquage</th><th class="r">PU HT</th><th class="r">Frais fixes</th><th class="r">PU tout compris</th><th class="r">Total HT</th><th class="r">Marge</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${r.qty}</b> pcs</td>${L.supplied ? "" : `<td class="r num">${fmtEUR(r.textile)}</td>`}<td class="r num">${fmtEUR(r.perso)}</td><td class="r num"><b>${fmtEUR(r.unit)}</b></td>
        <td class="r num">${r.setup ? fmtEUR(r.setup) : "—"}</td><td class="r num"><b style="color:var(--primary)">${fmtEUR(r.allIn)}</b></td><td class="r num">${fmtEUR(r.total)}</td>
        <td class="r num" style="color:${r.margin < 25 ? "var(--danger)" : "var(--success)"}">${r.margin} %</td></tr>`).join("")}
      </tbody></table></div><p class="hint" style="padding:0 16px 14px">« PU tout compris » répartit les frais fixes (écrans, digitalisation) sur la quantité.</p>`;
  };
  $("#pick").onclick = () => {
    articlePicker(a => { SIM.line = { ...lineFromArticle(a), id: "sim", perso: L.perso }; renderSimulator(main); });
  };
  $("#sCost").oninput = e => { L.cost = num(e.target.value); drawT(); };
  $("#sCoef").oninput = e => { L.coef = num(e.target.value); drawT(); };
  $("#sSup").onchange = e => { L.supplied = e.target.checked; renderSimulator(main); };
  $("#sQ").oninput = e => { SIM.qtys = e.target.value; drawT(); };
  $("#addP").onclick = () => {
    const t = S.techniques[0];
    L.perso.push({ id: uid("p"), techniqueId: t?.id, formatId: t?.formats?.[0]?.id || "", position: (S.settings.positions || [])[L.perso.length] || "", colors: 1 });
    drawP(); drawT();
  };
  $("#toQuote").onclick = () => {
    const line = clone(L);
    line.id = uid("l");
    line.sizes = {};
    line.perso.forEach(p => p.id = uid("p"));
    newQuote({ lines: [line] });
  };
  drawP(); drawT();
}
