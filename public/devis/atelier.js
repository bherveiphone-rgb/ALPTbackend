/* Atelier : planning de production (machines × jours, glisser-déposer) et stock. */
import { S, api, h, $, $$, icon, toast, fail, modal, confirmBox, fmtDate, fmtNum, download, toCSV, parseCSV, readAsText, pickFiles, parseNum } from "./ui.js";

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const monday = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/* ================================================================
   PLANNING
   ================================================================ */
let weekStart = monday(new Date());

export async function renderPlanning(main) {
  let d;
  try { d = await api("GET", "/planning"); } catch (e) { return fail(e); }
  const days = [...Array(d.weekends ? 7 : 5)].map((_, i) => { const x = new Date(weekStart); x.setDate(x.getDate() + i); return x; });
  const today = ymd(new Date());
  const unplanned = d.jobs.filter(j => !j.plannedDate || !j.machine).sort((a, b) => (a.deadline || 9e15) - (b.deadline || 9e15));
  const late = j => j.deadline && j.plannedDate && fromYmd(j.plannedDate).setHours(0) > new Date(j.deadline).setHours(23, 59);
  const overdue = d.jobs.filter(j => j.plannedDate && j.plannedDate < today && j.stage !== "marquage");
  const chip = j => `<div class="job ${late(j) ? "late" : ""}" draggable="true" data-job="${j.id}" title="${h(j.title)}">
      <b>${h(j.number)}</b> <span class="muted">${h(j.client)}</span><br>
      <span class="num">${j.qty} pcs</span>${j.deadline ? ` · <span class="${late(j) ? "danger" : "muted"}">pour le ${fmtDate(j.deadline)}</span>` : ""}
      ${j.ready ? "" : `<span title="Textile pas encore commandé/reçu">${icon("clock", "sm")}</span>`}${j.batValidated ? "" : `<span title="BAT non validé" class="danger">${icon("alert", "sm")}</span>`}</div>`;

  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Planning de production</h1><p>Glissez les commandes sur une machine et un jour. La charge est comparée à la capacité journalière de chaque machine.</p></div>
    <button class="btn" id="mach">${icon("gear")} Machines</button><button class="btn primary" id="auto">${icon("sparkle")} Planifier automatiquement</button></div>
    ${overdue.length ? `<div class="banner t-warning">${icon("alert")}<div class="grow">${overdue.length} commande(s) planifiée(s) dans le passé et pas encore en marquage : ${overdue.map(j => `<b>${h(j.number)}</b>`).join(", ")}</div></div>` : ""}
    <div class="plan-wrap">
      <div class="card plan-todo"><div class="card-h"><h2>À planifier</h2><span class="chip">${unplanned.length}</span></div>
        <div class="card-b stack drop-zone" data-drop="">${unplanned.map(chip).join("") || `<small class="muted">Tout est planifié 👍</small>`}</div></div>
      <div class="card plan-grid-card"><div class="card-h"><div class="row"><button class="btn sm ghost icon" id="prev">${icon("back", "sm")}</button>
          <b>Semaine du ${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</b>
          <button class="btn sm ghost icon" id="next" style="transform:scaleX(-1)">${icon("back", "sm")}</button><button class="btn sm" id="today">Aujourd'hui</button></div></div>
        <div class="plan-scroll"><table class="plan"><thead><tr><th></th>${days.map(x => `<th class="${ymd(x) === today ? "today" : ""}">${DAYS[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}</th>`).join("")}</tr></thead>
        <tbody>${d.machines.map(m => `<tr><th><b>${h(m.name)}</b><br><small class="muted">${m.capacity} pcs/jour</small></th>${days.map(x => {
          const jobs = d.jobs.filter(j => j.machine === m.id && j.plannedDate === ymd(x));
          const load = jobs.reduce((s, j) => s + j.qty, 0), pct = Math.round(load / m.capacity * 100);
          return `<td class="drop-zone ${ymd(x) === today ? "today" : ""}" data-drop="${m.id}|${ymd(x)}">
            ${jobs.length ? `<div class="load ${pct > 100 ? "over" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div><small class="${pct > 100 ? "danger" : "muted"}">${load}/${m.capacity} pcs${pct > 100 ? " · surcharge" : ""}</small>` : ""}
            ${jobs.map(chip).join("")}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div></div>
    </div>`;

  const save = async (id, plannedDate, machine) => {
    try { await api("PATCH", `/quotes/${id}/planning`, { plannedDate, machine }); renderPlanning(main); } catch (e) { fail(e); }
  };
  $$("[data-job]").forEach(el => {
    el.ondragstart = e => { e.dataTransfer.setData("text/plain", el.dataset.job); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
    el.onclick = () => jobModal(d, d.jobs.find(j => j.id === el.dataset.job), save);
  });
  $$("[data-drop]").forEach(z => {
    z.ondragover = e => { e.preventDefault(); z.classList.add("over"); };
    z.ondragleave = () => z.classList.remove("over");
    z.ondrop = e => {
      e.preventDefault(); z.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain"), [machine = "", date = ""] = z.dataset.drop.split("|");
      if (id) save(id, date, machine);
    };
  });
  const shift = n => { weekStart = new Date(weekStart); weekStart.setDate(weekStart.getDate() + n); renderPlanning(main); };
  $("#prev").onclick = () => shift(-7);
  $("#next").onclick = () => shift(7);
  $("#today").onclick = () => { weekStart = monday(new Date()); renderPlanning(main); };
  $("#auto").onclick = async () => {
    try { const r = await api("POST", "/planning/auto"); toast(r.placed ? `${r.placed} commande(s) planifiée(s)` : "Rien à planifier"); renderPlanning(main); } catch (e) { fail(e); }
  };
  $("#mach").onclick = () => machinesModal(d, () => renderPlanning(main));
}

function jobModal(d, j, save) {
  modal({
    title: `${j.number} — ${j.client}`,
    body: `<p class="muted" style="margin-top:0">${h(j.title)} · ${j.qty} pièces${j.deadline ? ` · à livrer le <b>${fmtDate(j.deadline)}</b>` : ""}</p>
      <div class="grid g2"><label class="f"><span>Jour</span><input type="date" id="jd" value="${h(j.plannedDate)}"></label>
      <label class="f"><span>Machine</span><select id="jm"><option value="">—</option>${d.machines.map(m => `<option value="${h(m.id)}" ${m.id === (j.machine || j.suggested) ? "selected" : ""}>${h(m.name)}</option>`).join("")}</select></label></div>
      <p style="margin-bottom:0"><a href="#/devis/${j.id}">Ouvrir le devis</a> · <a href="#/fiche/${j.id}">Fiche de fabrication</a></p>`,
    actions: [{ label: "Retirer du planning", cls: "ghost", onClick: () => save(j.id, "", "") }, { label: "Annuler" },
      { label: "Enregistrer", cls: "primary", onClick: m => save(j.id, $("#jd", m).value, $("#jm", m).value) }],
  });
}

function machinesModal(d, done) {
  let list = d.machines.map(m => ({ ...m, techniques: [...(m.techniques || [])] }));
  const techs = S.techniques;
  const draw = el => {
    $("#ml", el).innerHTML = list.map((m, i) => `<div class="card" style="padding:12px;margin-bottom:10px" data-m="${i}">
      <div class="row" style="flex-wrap:nowrap"><input type="text" data-k="name" value="${h(m.name)}" placeholder="Nom de la machine" style="flex:1">
        <div class="input-group" style="width:150px"><input type="number" min="1" data-k="capacity" value="${h(m.capacity)}"><span class="addon">pcs/j</span></div>
        <button class="btn sm ghost icon" data-del>${icon("trash", "sm")}</button></div>
      <div class="row" style="margin-top:8px;gap:4px 12px">${techs.map(t => `<label class="check"><input type="checkbox" data-t="${h(t.id)}" ${m.techniques.includes(t.id) ? "checked" : ""}> ${h(t.name)}</label>`).join("")}</div></div>`).join("");
    $$("[data-m]", el).forEach(row => {
      const m = list[+row.dataset.m];
      $$("[data-k]", row).forEach(i => i.oninput = () => { m[i.dataset.k] = i.dataset.k === "capacity" ? parseInt(i.value, 10) || 1 : i.value; });
      $$("[data-t]", row).forEach(c => c.onchange = () => { m.techniques = c.checked ? [...m.techniques, c.dataset.t] : m.techniques.filter(x => x !== c.dataset.t); });
      $("[data-del]", row).onclick = () => { list.splice(+row.dataset.m, 1); draw(el); };
    });
  };
  modal({
    title: "Machines & capacités", size: "wide",
    body: `<p class="hint" style="margin-top:0">Capacité = nombre de pièces marquées par jour. Cochez les techniques réalisées sur chaque machine : la planification automatique s'en sert.</p>
      <div id="ml"></div><button class="btn sm" id="ma">${icon("plus", "sm")} Ajouter une machine</button>
      <div class="grid g2" style="margin-top:14px"><label class="f"><span>Délai avant marquage si le textile n'est pas commandé</span><div class="input-group"><input type="number" min="0" id="lead" value="${h(S.settings.planningLeadDays ?? 3)}"><span class="addon">jours</span></div></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="we" ${d.weekends ? "checked" : ""}> Travailler le week-end</label></div>`,
    onOpen: el => { draw(el); $("#ma", el).onclick = () => { list.push({ id: "", name: "", capacity: 100, techniques: [] }); draw(el); }; },
    actions: [{ label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async el => {
      const machines = await api("PUT", "/machines", { machines: list, weekends: $("#we", el).checked, leadDays: $("#lead", el).value });
      Object.assign(S.settings, { machines, planningWeekends: $("#we", el).checked, planningLeadDays: parseInt($("#lead", el).value, 10) || 0 });
      toast("Machines enregistrées"); done();
    } }],
  });
}

/* ================================================================
   STOCK
   ================================================================ */
let stockTab = "article";
export async function renderStock(main) {
  let items = [];
  try { items = await api("GET", "/stock"); } catch (e) { return fail(e); }
  const list = items.filter(i => i.kind === stockTab);
  const low = items.filter(i => i.min > 0 && i.qty <= i.min);
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Stock</h1><p>Textile et objets d'avance (déduits automatiquement au lancement du marquage et dans les achats) et consommables (encres, films, fils…).</p></div>
    <button class="btn" id="imp">${icon("upload")} Importer</button><button class="btn" id="exp">${icon("download")} Exporter</button><button class="btn primary" id="add">${icon("plus")} Ajouter</button></div>
    ${low.length ? `<div class="banner t-warning">${icon("alert")}<div class="grow"><b>${low.length} article(s) sous le seuil</b> : ${low.slice(0, 8).map(i => h(label(i))).join(", ")}${low.length > 8 ? "…" : ""}</div></div>` : ""}
    <div class="tabs" style="margin-bottom:14px"><button class="${stockTab === "article" ? "on" : ""}" data-tab="article">Textile & objets</button><button class="${stockTab === "consommable" ? "on" : ""}" data-tab="consommable">Consommables</button></div>
    <div class="card"><div class="card-h"><div class="search" style="max-width:320px">${icon("search", "sm")}<input type="search" id="sq" placeholder="Rechercher…"></div><small class="muted">${list.length} ligne(s) · ${fmtNum(list.reduce((s, i) => s + (i.qty || 0), 0))} au total</small></div>
    <div style="overflow-x:auto"><table class="t"><thead><tr>${stockTab === "article" ? "<th>Référence</th><th>Désignation</th><th>Couleur</th><th>Taille</th>" : "<th>Consommable</th><th>Emplacement</th>"}<th class="r">Quantité</th><th class="r">Seuil</th><th style="width:210px"></th></tr></thead>
    <tbody id="sb">${list.map(i => `<tr data-s="${i.id}" data-txt="${h([i.ref, i.name, i.color, i.size, i.location].join(" ").toLowerCase())}">
      ${stockTab === "article" ? `<td><b>${h(i.ref)}</b></td><td>${h(i.name)}</td><td>${h(i.color)}</td><td>${h(i.size)}</td>` : `<td><b>${h(i.name)}</b>${i.ref ? ` <small class="muted">${h(i.ref)}</small>` : ""}</td><td>${h(i.location)}</td>`}
      <td class="r num"><b class="${i.min > 0 && i.qty <= i.min ? "danger" : ""}">${fmtNum(i.qty, 3)}</b> <small class="muted">${h(i.unit)}</small></td><td class="r num muted">${i.min || "—"}</td>
      <td class="r"><button class="btn sm" data-mv="-1" title="Sortie">−</button> <button class="btn sm" data-mv="1" title="Entrée">+</button> <button class="btn sm" data-count>Inventaire</button> <button class="btn sm ghost icon" data-ed>${icon("pen", "sm")}</button></td></tr>`).join("")
      || `<tr><td colspan="8" class="empty">Aucun article en stock. Ajoutez vos pièces d'avance ou vos consommables.</td></tr>`}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Derniers mouvements</h2></div><div class="card-b" id="mvs"><small class="muted">Chargement…</small></div></div>`;

  $$("[data-tab]").forEach(b => b.onclick = () => { stockTab = b.dataset.tab; renderStock(main); });
  $("#sq").oninput = e => { const s = e.target.value.toLowerCase(); $$("#sb [data-s]").forEach(r => r.classList.toggle("hidden", !r.dataset.txt.includes(s))); };
  $("#add").onclick = () => itemModal({ kind: stockTab }, () => renderStock(main));
  $("#exp").onclick = () => download(`stock-${ymd(new Date())}.csv`, toCSV([["Type", "Référence", "Désignation", "Couleur", "Taille", "Quantité", "Unité", "Seuil", "Emplacement"],
    ...items.map(i => [i.kind, i.ref, i.name, i.color, i.size, i.qty, i.unit, i.min, i.location])]), "text/csv");
  $("#imp").onclick = () => importStock(() => renderStock(main));
  $$("#sb [data-s]").forEach(r => {
    const it = items.find(i => i.id === r.dataset.s);
    $$("[data-mv]", r).forEach(b => b.onclick = () => moveModal(it, +b.dataset.mv, () => renderStock(main)));
    $("[data-count]", r).onclick = () => moveModal(it, 0, () => renderStock(main));
    $("[data-ed]", r).onclick = () => itemModal(it, () => renderStock(main));
  });
  api("GET", "/stock/moves").then(mv => {
    const box = $("#mvs");
    if (!box) return;
    box.innerHTML = mv.length ? `<table class="t"><tbody>${mv.slice(0, 40).map(m => { const i = items.find(x => x.id === m.itemId); return `<tr><td class="muted" style="width:150px">${fmtDate(m.at, true)}</td><td>${h(i ? label(i) : "Article supprimé")}</td>
      <td class="r num" style="width:90px;color:${m.delta < 0 ? "var(--danger)" : "var(--success)"}">${m.delta > 0 ? "+" : ""}${fmtNum(m.delta, 3)}</td><td>${h(m.reason)}${m.quoteId ? ` <a href="#/devis/${m.quoteId}">voir</a>` : ""}${m.user ? ` <small class="muted">· ${h(m.user)}</small>` : ""}</td></tr>`; }).join("")}</tbody></table>`
      : `<small class="muted">Aucun mouvement pour l'instant.</small>`;
  }).catch(() => {});
}
const label = i => [i.ref, i.name, i.color, i.size].filter(Boolean).join(" ");

function itemModal(it, done) {
  const isNew = !it.id, art = it.kind !== "consommable";
  modal({
    title: isNew ? "Ajouter au stock" : "Modifier l'article",
    body: `<div class="grid g2">
      <label class="f"><span>Type</span><select id="ik"><option value="article" ${art ? "selected" : ""}>Textile / objet</option><option value="consommable" ${art ? "" : "selected"}>Consommable</option></select></label>
      <label class="f"><span>Référence</span><input type="text" id="ir" value="${h(it.ref)}" list="irl"><datalist id="irl">${S.catalog.map(a => `<option value="${h(a.ref)}">${h(a.name)}</option>`).join("")}</datalist></label>
      <label class="f"><span>Désignation</span><input type="text" id="in" value="${h(it.name)}"></label>
      <label class="f"><span>Couleur</span><input type="text" id="ic" value="${h(it.color)}"></label>
      <label class="f"><span>Taille</span><input type="text" id="is" value="${h(it.size)}" placeholder="S, M, L…"></label>
      <label class="f"><span>Unité</span><input type="text" id="iu" value="${h(it.unit || (art ? "pcs" : "u."))}" placeholder="pcs, L, m, rouleaux…"></label>
      ${isNew ? `<label class="f"><span>Quantité initiale</span><input type="number" step="any" id="iq" value="0"></label>` : ""}
      <label class="f"><span>Seuil d'alerte</span><input type="number" step="any" min="0" id="im" value="${h(it.min ?? 0)}"></label>
      <label class="f"><span>Emplacement</span><input type="text" id="il" value="${h(it.location)}" placeholder="Étagère B2…"></label></div>
      <p class="hint">Pour le textile, la référence, la couleur et la taille doivent correspondre à celles des devis pour la déduction automatique.</p>`,
    onOpen: el => { $("#ir", el).onchange = e => { const a = S.catalog.find(x => x.ref === e.target.value); if (a && !$("#in", el).value) $("#in", el).value = a.name; }; },
    actions: [...(isNew ? [] : [{ label: "Supprimer", cls: "danger ghost", onClick: async () => {
      if (!(await confirmBox("Supprimer cet article du stock ?", label(it), { danger: true, label: "Supprimer" }))) return false;
      await api("DELETE", `/stock/${it.id}`); done();
    } }]), { label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async el => {
      const b = { kind: $("#ik", el).value, ref: $("#ir", el).value, name: $("#in", el).value, color: $("#ic", el).value, size: $("#is", el).value, unit: $("#iu", el).value, min: $("#im", el).value, location: $("#il", el).value,
        articleId: S.catalog.find(a => a.ref === $("#ir", el).value)?.id || "" };
      if (isNew) await api("POST", "/stock", { ...b, qty: parseNum($("#iq", el).value) || 0 });
      else await api("PUT", `/stock/${it.id}`, b);
      toast("Stock enregistré"); done();
    } }],
  });
}

function moveModal(it, dir, done) {
  const count = dir === 0;
  modal({
    title: count ? `Inventaire — ${label(it)}` : `${dir > 0 ? "Entrée" : "Sortie"} — ${label(it)}`,
    body: `<p class="muted" style="margin-top:0">En stock : <b>${fmtNum(it.qty, 3)} ${h(it.unit)}</b></p>
      <div class="grid g2"><label class="f"><span>${count ? "Quantité comptée" : "Quantité"}</span><input type="number" step="any" min="0" id="mq" value="${count ? it.qty : ""}"></label>
      <label class="f"><span>Motif</span><input type="text" id="mr" placeholder="${count ? "Inventaire" : dir > 0 ? "Réception fournisseur" : "Casse, échantillon…"}"></label></div>`,
    actions: [{ label: "Annuler" }, { label: "Valider", cls: "primary", onClick: async el => {
      const n = parseNum($("#mq", el).value);
      if (n === null) { fail("Indiquez une quantité"); return false; }
      await api("POST", `/stock/${it.id}/move`, count ? { count: n, reason: $("#mr", el).value } : { delta: dir * Math.abs(n), reason: $("#mr", el).value });
      toast("Stock mis à jour"); done();
    } }],
  });
}

async function importStock(done) {
  const [f] = await pickFiles({ accept: ".csv,text/csv", multiple: false });
  if (!f) return;
  const rows = parseCSV(await readAsText(f));
  const head = (rows[0] || []).map(x => x.toLowerCase());
  const col = (...k) => head.findIndex(x => k.some(y => x.includes(y)));
  const c = { ref: col("réf", "ref"), name: col("désign", "nom", "name"), color: col("coul", "color"), size: col("taille", "size"), qty: col("quant", "qty", "stock"), min: col("seuil", "min"), unit: col("unit"), type: col("type") };
  if (c.qty < 0 || (c.ref < 0 && c.name < 0)) return fail("Colonnes attendues : Référence (ou Désignation), Quantité ; facultatif : Couleur, Taille, Seuil, Unité, Type.");
  const items = rows.slice(1).filter(r => r.some(Boolean));
  let n = 0;
  for (const r of items) {
    const v = k => (c[k] >= 0 ? String(r[c[k]] ?? "").trim() : "");
    try {
      await api("POST", "/stock", { kind: /conso/i.test(v("type")) ? "consommable" : "article", ref: v("ref"), name: v("name"), color: v("color"), size: v("size"), unit: v("unit"), min: parseNum(v("min")) || 0, qty: parseNum(v("qty")) || 0 });
      n++;
    } catch { /* ligne ignorée */ }
  }
  toast(`${n} ligne(s) importée(s)`); done();
}
