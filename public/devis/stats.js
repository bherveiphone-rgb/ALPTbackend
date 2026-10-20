/* Statistiques : chiffre d'affaires, marges par technique / univers / client, conversion par origine. */
import { api, h, $, $$, icon, fail, fmtEUR, fmtNum, download, toCSV } from "./ui.js";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const SOURCES = { form: "Formulaire en ligne", email: "Email reçu", manuel: "Saisie manuelle", import: "Import", formulaire: "Formulaire", prospection: "Prospection", boutique: "Boutique club", devis: "Créé depuis un devis", inconnue: "Non renseignée", autre: "Autre" };
let period = "year";

const ranges = () => {
  const now = new Date(), y = now.getFullYear();
  return {
    month: ["Ce mois", new Date(y, now.getMonth(), 1)], quarter: ["Ce trimestre", new Date(y, Math.floor(now.getMonth() / 3) * 3, 1)],
    year: ["Cette année", new Date(y, 0, 1)], last: ["Année dernière", new Date(y - 1, 0, 1), new Date(y, 0, 1) - 1], all: ["Depuis le début", new Date(2000, 0, 1)],
  };
};

export async function renderStats(main) {
  const r = ranges()[period];
  let d;
  try { d = await api("GET", `/stats?from=${r[1].getTime()}&to=${r[2] || Date.now()}`); } catch (e) { return fail(e); }
  const K = d.kpis;
  const tile = (label, value, sub = "") => `<div class="card stat-tile"><small>${label}</small><b class="num">${value}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Statistiques</h1><p>Basées sur les devis signés (date de signature). Marges estimées à partir des prix d'achat et du % de coût des techniques.</p></div>
    <div class="seg">${Object.entries(ranges()).map(([k, v]) => `<button class="${k === period ? "on" : ""}" data-p="${k}">${v[0]}</button>`).join("")}</div>
    <button class="btn" id="csv">${icon("download")} Exporter</button></div>
    <div class="stat-grid">
      ${tile("Chiffre d'affaires HT", fmtEUR(K.ca), `${K.signed} commande${K.signed > 1 ? "s" : ""} · ${fmtNum(K.pieces, 0)} pièces`)}
      ${tile("Marge estimée", fmtEUR(K.margin), `${K.marginPct} % du CA`)}
      ${tile("Panier moyen HT", fmtEUR(K.avgBasket))}
      ${tile("Taux de transformation", `${K.conversion} %`, `${K.sent} devis envoyés${K.avgDaysToSign !== null ? ` · signés en ${fmtNum(K.avgDaysToSign, 1)} j en moyenne` : ""}`)}
      ${tile("En attente de réponse", fmtEUR(K.pipeline), "devis envoyés non signés")}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Chiffre d'affaires HT par mois</h2><small class="muted">12 derniers mois</small></div><div class="card-b">${monthChart(d.months)}</div></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      ${rankCard("Par technique de marquage", d.techniques, x => x.label, true)}
      ${rankCard("Par univers", d.universes, x => x.label, true)}
      ${rankCard("Meilleurs clients", d.clients, x => x.label, true)}
      <div class="card"><div class="card-h"><h2>Demandes par origine</h2></div><div class="card-b">${d.sources.length ? `<table class="t"><thead><tr><th>Origine</th><th class="r">Demandes</th><th class="r">Signées</th><th class="r">Taux</th><th class="r">CA HT</th></tr></thead><tbody>
        ${d.sources.map(s => `<tr><td>${h(SOURCES[s.source] || s.source)}</td><td class="r num">${s.requests}</td><td class="r num">${s.won}</td><td class="r num"><b>${Math.round(s.won / s.requests * 100)} %</b></td><td class="r num">${fmtEUR(s.ht)}</td></tr>`).join("")}</tbody></table>` : `<small class="muted">Aucune demande sur la période.</small>`}
        ${d.clientSources.length ? `<div class="section-lbl" style="margin-top:16px">CA par origine du contact</div>${bars(d.clientSources.map(s => ({ label: SOURCES[s.source] || s.source, value: s.ht, text: `${fmtEUR(s.ht)} · ${s.count} cde` })))}` : ""}</div></div>
      ${d.lost.length ? `<div class="card"><div class="card-h"><h2>Raisons de perte</h2></div><div class="card-b">${bars(d.lost.map(l => ({ label: l.reason, value: l.count, text: `${l.count} devis` })))}</div></div>` : ""}
    </div>`;
  $$("[data-p]").forEach(b => b.onclick = () => { period = b.dataset.p; renderStats(main); });
  $("#csv").onclick = () => download(`statistiques-${period}.csv`, toCSV([
    ["Type", "Libellé", "CA HT", "Coût", "Marge", "Marge %", "Pièces"],
    ...d.months.map(m => ["Mois", m.month, m.ht, "", m.margin, "", ""]),
    ...[["Technique", d.techniques], ["Univers", d.universes], ["Client", d.clients]].flatMap(([t, l]) => l.map(x => [t, x.label, x.ht, x.cost, x.margin, x.marginPct, x.qty])),
  ]), "text/csv");
}

/** Histogramme mensuel (une seule série : pas de légende, valeur au survol, table accessible). */
function monthChart(months) {
  const max = Math.max(1, ...months.map(m => m.ht));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const label = m => { const [y, mo] = m.month.split("-"); return `${MONTHS[+mo - 1]}${mo === "01" ? ` ${y.slice(2)}` : ""}`; };
  return `<div class="mchart" role="img" aria-label="Chiffre d'affaires HT par mois">
    <div class="mchart-grid"><span>${fmtEUR(nice)}</span><span>${fmtEUR(nice / 2)}</span><span>0</span></div>
    <div class="mchart-bars">${months.map((m, i) => `<div class="mcol ${i % 2 ? "alt" : ""}" tabindex="0">
      <div class="mbar-wrap"><div class="mbar" style="height:${m.ht / nice * 100}%"></div></div>
      <small>${label(m)}</small>
      <div class="mtip"><b>${label(m)}</b><br>${fmtEUR(m.ht)} HT<br><span>Marge ${fmtEUR(m.margin)} · ${m.count} cde</span></div></div>`).join("")}</div></div>
    <details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:12.5px">Voir les chiffres</summary>
      <table class="t"><thead><tr><th>Mois</th><th class="r">CA HT</th><th class="r">Marge</th><th class="r">Commandes</th></tr></thead><tbody>${months.map(m => `<tr><td>${label(m)}</td><td class="r num">${fmtEUR(m.ht)}</td><td class="r num">${fmtEUR(m.margin)}</td><td class="r num">${m.count}</td></tr>`).join("")}</tbody></table></details>`;
}

const bars = rows => {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="hbars">${rows.map(r => `<div class="hbar" title="${h(r.label)} : ${h(r.text)}"><span class="lbl">${h(r.label)}</span><span class="track"><i style="width:${r.value / max * 100}%"></i></span><span class="val num">${h(r.text)}</span></div>`).join("")}</div>`;
};

function rankCard(title, list, name, showMargin) {
  return `<div class="card"><div class="card-h"><h2>${title}</h2></div><div class="card-b">${list.length ? `${bars(list.slice(0, 10).map(x => ({ label: name(x), value: x.ht, text: fmtEUR(x.ht) })))}
    ${showMargin ? `<table class="t" style="margin-top:12px"><thead><tr><th></th><th class="r">CA HT</th><th class="r">Marge</th><th class="r">%</th></tr></thead><tbody>${list.slice(0, 10).map(x => `<tr><td>${h(name(x))}</td><td class="r num">${fmtEUR(x.ht)}</td><td class="r num">${fmtEUR(x.margin)}</td><td class="r num" style="color:${x.marginPct < 25 ? "var(--danger)" : "var(--text)"}">${x.marginPct} %</td></tr>`).join("")}</tbody></table>` : ""}`
    : `<small class="muted">Pas encore de commande signée sur la période.</small>`}</div></div>`;
}
