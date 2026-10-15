/* Espace client : consulter / accepter le devis, valider le BAT, échanger avec l'atelier. */
import { h, $, $$, icon, toast, fail, modal, fmtEUR, fmtDate, lightbox, bindDrop, readAsDataURL, shrinkImage } from "./ui.js";

const params = new URLSearchParams(location.search);
const TOKEN = params.get("t") || "";
const PREVIEW = params.has("preview") || params.has("print");
const PRINT = params.has("print");
const root = $("#root");
let D = null;

async function call(method, url, body) {
  const res = await fetch(`/api/devis/public/${encodeURIComponent(TOKEN)}${url}`, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
async function upload(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} : fichier trop lourd (max 15 Mo)`);
  const dataUrl = await shrinkImage(await readAsDataURL(file));
  return call("POST", "/upload", { dataUrl, name: file.name });
}

/* ---------- Pad de signature ---------- */
function signaturePad(canvas) {
  const ctx = canvas.getContext("2d");
  const fit = () => {
    const r = canvas.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    canvas.width = r.width * k; canvas.height = r.height * k;
    ctx.scale(k, k); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827";
  };
  fit();
  let drawing = false, empty = true, last = null;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.onpointerdown = e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1, 0, 7); ctx.fill(); empty = false; };
  canvas.onpointermove = e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; };
  canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
  return {
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    isEmpty: () => empty,
    toDataURL: () => {
      // export compact sur fond blanc
      const c = document.createElement("canvas"); c.width = 600; c.height = Math.round(600 * canvas.height / canvas.width);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    },
  };
}

function signModal({ title, intro, checklist = [], cta, onSubmit }) {
  const m = modal({
    title, size: "wide",
    body: `${intro ? `<p style="margin-top:0">${intro}</p>` : ""}
      ${checklist.length ? `<div class="checklist" style="margin-bottom:14px">${checklist.map((c, i) => `<label><input type="checkbox" data-ck="${i}"><span>${h(c)}</span></label>`).join("")}</div>` : ""}
      <label class="f"><span>Nom et prénom du signataire</span><input type="text" id="sgName" autocomplete="name" value="${h(D.client?.contact || "")}"></label>
      <label class="f" style="margin-top:12px"><span>Commentaire (facultatif)</span><input type="text" id="sgCom"></label>
      <div style="margin-top:12px"><div class="row between"><span style="font-size:12.5px;font-weight:600;color:var(--muted)">Signature</span><button class="link-btn" id="sgClear">Effacer</button></div>
      <canvas class="sig-pad" id="sgPad"></canvas><div class="hint">Signez avec la souris ou le doigt. Votre signature vaut « Bon pour accord ».</div></div>`,
    actions: [{ label: "Annuler" }, { label: cta, cls: "success", icon: "check", onClick: async mm => {
      if ($$("[data-ck]", mm).some(c => !c.checked)) throw new Error("Merci de cocher tous les points de contrôle.");
      const name = $("#sgName", mm).value.trim();
      if (!name) throw new Error("Indiquez votre nom.");
      if (pad.isEmpty()) throw new Error("Merci de signer dans le cadre.");
      await onSubmit({ name, signature: pad.toDataURL(), comment: $("#sgCom", mm).value });
    } }],
  });
  const pad = signaturePad($("#sgPad", m.el));
  $("#sgClear", m.el).onclick = () => pad.clear();
}

/* ---------- Rendu principal ---------- */
const STEP_DEFS = [["Devis", "file"], ["Accepté", "check"], ["BAT validé", "image"], ["Production", "brush"], ["Livré", "sparkle"]];
function stepIndex() {
  const lastBat = D.bats[D.bats.length - 1];
  if (D.status === "livre") return 5;
  if (D.status === "production") return 3;
  if (lastBat?.status === "valide") return 3;
  if (["accepte"].includes(D.status)) return 2;
  return 1;
}

function render() {
  if (PRINT) return renderPrint();
  const co = D.company || {};
  const T = D.totals;
  const accepted = ["accepte", "production", "livre"].includes(D.status);
  const expired = D.validUntil && Date.now() > D.validUntil + 864e5 && !accepted;
  const canAccept = !accepted && !["refuse", "annule"].includes(D.status) && !expired;
  const lastBat = D.bats[D.bats.length - 1];
  const si = stepIndex();
  document.title = `Devis ${D.number} — ${co.name || ""}`;

  root.innerHTML = `
  ${PREVIEW ? `<div style="background:#fef3c7;color:#92400e;text-align:center;padding:8px;font-weight:600;font-size:13px">Aperçu atelier — ce que voit votre client (les actions sont désactivées)</div>` : ""}
  <div class="top"><div class="wrap">${co.logo ? `<img src="${h(co.logo)}" alt="">` : `<div class="brand" style="padding:0;color:var(--text)"><div class="logo">${icon("file")}</div></div>`}
    <div style="flex:1"><b>${h(co.name)}</b><br><small class="muted">${h([co.phone, co.email].filter(Boolean).join(" · "))}</small></div>
    <a class="btn sm" href="?t=${encodeURIComponent(TOKEN)}&print=1" target="_blank">${icon("download", "sm")} PDF</a></div></div>
  <div class="wrap">
    <div class="hero">
      <div><small>Devis n° ${h(D.number)} · émis le ${fmtDate(D.createdAt)}</small><h1 style="margin-top:6px">${h(D.title || "Votre devis personnalisé")}</h1>
        <small>${D.client?.company ? h(D.client.company) + " · " : ""}${expired ? "⚠ Devis expiré" : `Valable jusqu'au ${fmtDate(D.validUntil)}`}</small></div>
      <div><div class="amount num">${fmtEUR(T.ttc)}</div><div style="text-align:right"><small>TTC · ${fmtEUR(T.ht)} HT</small></div></div>
    </div>
    <div class="steps">${STEP_DEFS.map(([l, ic], i) => `<div class="step ${i < si ? "done" : i === si ? "cur" : ""}"><span class="n">${i < si ? icon("check", "sm") : i + 1}</span>${l}</div>`).join("")}</div>
    ${callout(canAccept, accepted, expired, lastBat)}
    <div id="batSec"></div>
    <div class="card"><div class="card-h"><h2>Détail du devis</h2><small class="muted">${T.qty} pièce${T.qty > 1 ? "s" : ""}</small></div>
      <div class="table-wrap"><table class="t lines-t"><thead><tr><th>Article</th><th class="hide-m">Tailles</th><th class="r">Qté</th><th class="r">PU HT</th><th class="r">Total HT</th></tr></thead><tbody>
      ${D.lines.map(l => `<tr><td><div class="row" style="flex-wrap:nowrap;align-items:flex-start">${l.image ? `<div class="thumb"><img src="${h(l.image)}"></div>` : ""}<div>
        <b>${h(l.name)}</b>${l.color ? ` — ${h(l.color)}` : ""}<br><small class="muted">${h([l.ref, l.brand].filter(Boolean).join(" · "))}</small>
        ${l.persos.length ? `<ul class="persos">${l.persos.map(p => `<li>${h(p.technique)} — ${h(p.position || "")}${p.w && p.h ? ` · ${p.w}×${p.h} cm` : ` · ${h(p.format)}`}${p.colors ? ` · ${p.colors} coul.` : ""}</li>`).join("")}</ul>` : ""}
        ${l.note ? `<div style="font-size:12.5px;margin-top:4px">${h(l.note)}</div>` : ""}</div></div></td>
        <td class="hide-m"><small>${l.sizes.map(s => `${h(s.size)} : ${s.qty}`).join("<br>")}</small></td>
        <td class="r num">${l.qty}</td><td class="r num">${fmtEUR(l.unit)}</td><td class="r num"><b>${fmtEUR(l.total)}</b></td></tr>`).join("")}
      ${D.setups.map(s => `<tr><td colspan="2">${h(s.label)}</td><td class="r">1</td><td class="r num">${fmtEUR(s.amount)}</td><td class="r num"><b>${fmtEUR(s.amount)}</b></td></tr>`).join("")}
      ${D.fees.map(f => `<tr><td colspan="2">${h(f.label)}</td><td class="r">${f.qty}</td><td class="r num">${fmtEUR(f.unit)}</td><td class="r num"><b>${fmtEUR(f.total)}</b></td></tr>`).join("")}
      </tbody></table></div>
      <div class="card-b" style="display:flex;justify-content:flex-end"><div style="width:min(320px,100%)">${totalsHtml(T)}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><div class="card-h"><h2>Échanger avec nous</h2></div><div class="card-b" id="msgSec"></div></div>
      <div class="card"><div class="card-h"><h2>Informations</h2></div><div class="card-b stack">
        ${D.notes ? `<div style="white-space:pre-wrap">${h(D.notes)}</div>` : ""}
        ${D.leadTime ? `<div>${icon("clock", "sm")} <b>Délai :</b> ${h(D.leadTime)}</div>` : ""}
        ${T.deposit ? `<div>${icon("card", "sm")} <b>Acompte à la commande :</b> ${fmtEUR(T.deposit)} (${T.depositPct} %)${co.iban ? `<br><small class="muted">Par virement — IBAN : ${h(co.iban)}${co.bic ? ` · BIC : ${h(co.bic)}` : ""}</small>` : ""}</div>` : ""}
        ${D.conditions ? `<small class="muted" style="white-space:pre-wrap;display:block">${h(D.conditions)}</small>` : ""}
      </div></div>
    </div>
    ${canAccept ? `<div class="row" style="justify-content:center;margin-top:22px"><button class="btn ghost" id="decline">Décliner ce devis</button></div>` : ""}
  </div>`;

  $("#accept")?.addEventListener("click", acceptQuote);
  $("#accept2")?.addEventListener("click", acceptQuote);
  $("#goBat")?.addEventListener("click", () => $("#batSec").scrollIntoView({ behavior: "smooth" }));
  $("#decline")?.addEventListener("click", declineQuote);
  $("#payDeposit")?.addEventListener("click", payDeposit);
  renderBat();
  renderMessages();
}

function callout(canAccept, accepted, expired, lastBat) {
  if (D.decline) return `<div class="callout t-danger" style="border:1px solid">${icon("x")}<div class="grow"><b>Vous avez décliné ce devis.</b> N'hésitez pas à nous écrire si vous souhaitez une nouvelle proposition.</div></div>`;
  if (expired) return `<div class="callout t-warning" style="border:1px solid">${icon("clock")}<div class="grow"><b>Ce devis a expiré.</b> Écrivez-nous ci-dessous pour le réactualiser.</div></div>`;
  if (canAccept) return `<div class="callout card"><div class="grow"><b>Ce devis vous convient ?</b><br><small class="muted">Acceptez-le en ligne en signant électroniquement. Nous vous enverrons ensuite le BAT à valider.</small></div>
    <button class="btn success lg" id="accept">${icon("pen")} Accepter et signer</button></div>`;
  const dep = D.deposit;
  const depBtn = dep.enabled && !dep.paid && dep.amount > 0 ? `<button class="btn primary" id="payDeposit">${icon("card")} Régler l'acompte (${fmtEUR(dep.amount)})</button>` : "";
  const depOk = dep.paid ? `<span class="badge t-success">Acompte réglé le ${fmtDate(dep.paidAt)}</span>` : "";
  if (lastBat?.status === "en_attente") return `<div class="callout t-warning" style="border:1px solid">${icon("image")}<div class="grow"><b>Votre BAT V${lastBat.version} est prêt !</b><br>Vérifiez-le attentivement puis validez-le pour lancer la production.</div><button class="btn primary lg" id="goBat">Voir le BAT</button></div>`;
  if (accepted) return `<div class="callout t-success" style="border:1px solid">${icon("check")}<div class="grow"><b>Devis accepté${D.acceptance ? ` par ${h(D.acceptance.name)} le ${fmtDate(D.acceptance.at)}` : ""}.</b>
    ${lastBat?.status === "valide" ? "BAT validé : votre commande part en production." : lastBat?.status === "modif" ? "Nous préparons une nouvelle version de votre BAT." : "Nous préparons votre BAT, vous serez prévenu dès qu'il sera disponible."}</div>${depOk}${depBtn}</div>`;
  return "";
}

const totalsHtml = T => {
  const r = (k, v, st = "") => `<div class="sum-row" style="${st}"><span>${k}</span><span class="num">${v}</span></div>`;
  return `${r("Sous-total HT", fmtEUR(T.subtotal))}${T.discount ? r(`Remise ${T.discountPct} %`, "− " + fmtEUR(T.discount)) : ""}${T.shipping ? r("Livraison", fmtEUR(T.shipping)) : ""}
    ${r("<b>Total HT</b>", `<b>${fmtEUR(T.ht)}</b>`)}${r(`TVA ${T.vatRate} %`, fmtEUR(T.vat), "color:var(--muted)")}
    <div class="sum-row total"><span>Total TTC</span><span class="num">${fmtEUR(T.ttc)}</span></div>`;
};

/* ---------- BAT ---------- */
function renderBat() {
  const sec = $("#batSec");
  if (!D.bats.length) { sec.innerHTML = ""; return; }
  const last = D.bats[D.bats.length - 1];
  const older = D.bats.slice(0, -1).reverse();
  const st = { en_attente: ["À valider", "warning"], valide: ["Validé", "success"], modif: ["Modification demandée", "danger"], remplace: ["Remplacé", "neutral"] };
  const files = b => `<div class="${b === last ? "bat-hero" : "bat-files"}">${b.files.map(f => `<div class="bat-file">${f.type === "pdf"
    ? `<a class="pdf" href="${h(f.url)}" target="_blank" style="min-height:160px">${icon("file")}Ouvrir le PDF<br><small>${h(f.name)}</small></a>`
    : `<img src="${h(f.url)}" data-lb="${h(f.url)}" alt="${h(f.name)}">`}</div>`).join("")}</div>`;
  sec.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>${icon("image")} Bon à tirer — V${last.version}</h2><span class="badge t-${st[last.status][1]}">${st[last.status][0]}</span></div>
    <div class="card-b stack">
      ${last.message ? `<div class="msg" style="max-width:none">${h(last.message)}</div>` : ""}
      ${files(last)}
      ${last.specs ? `<details open><summary style="cursor:pointer;font-weight:600">Caractéristiques techniques</summary><pre style="white-space:pre-wrap;font-family:inherit;margin:8px 0 0;color:var(--muted)">${h(last.specs)}</pre></details>` : ""}
      ${last.status === "en_attente" ? `<div class="callout" style="background:var(--surface-2);border:1px solid var(--border);margin:0">
          <div class="grow"><b>Après validation, aucune modification ne sera possible.</b><br><small class="muted">Vérifiez l'orthographe, les couleurs, les dimensions et les emplacements.</small></div>
          <button class="btn" id="batKo">${icon("pen", "sm")} Demander une modification</button>
          <button class="btn success lg" id="batOk">${icon("check")} Valider le BAT</button></div>`
        : last.response ? `<div class="margin-box" style="margin:0;border-style:solid">${last.status === "valide" ? `✅ Validé par <b>${h(last.response.name)}</b> le ${fmtDate(last.response.at, true)}` : `✏️ Modification demandée le ${fmtDate(last.response.at, true)} : « ${h(last.response.comment)} »`}</div>` : ""}
      ${older.length ? `<details><summary style="cursor:pointer;color:var(--muted)">Versions précédentes (${older.length})</summary>${older.map(b => `<div style="margin-top:12px"><b>V${b.version}</b> <span class="badge t-${st[b.status][1]}">${st[b.status][0]}</span>${b.response?.comment ? ` <small class="muted">« ${h(b.response.comment)} »</small>` : ""}<div style="margin-top:8px">${files(b)}</div></div>`).join("")}</details>` : ""}
    </div></div>`;
  $$("[data-lb]", sec).forEach(i => i.onclick = () => lightbox(i.dataset.lb));
  $("#batOk")?.addEventListener("click", () => {
    if (PREVIEW) return toast("Aperçu : action désactivée", "err");
    signModal({
      title: `Valider le BAT V${last.version}`, intro: "Merci de confirmer chaque point avant de valider :",
      checklist: D.batChecklist || [], cta: "Je valide le BAT",
      onSubmit: async data => { D = await call("POST", `/bats/${last.id}/approve`, data); render(); toast("Merci ! Votre BAT est validé, nous lançons la production."); },
    });
  });
  $("#batKo")?.addEventListener("click", () => {
    if (PREVIEW) return toast("Aperçu : action désactivée", "err");
    let files = [];
    const m = modal({
      title: "Demander une modification",
      body: `<label class="f"><span>Que souhaitez-vous modifier ?</span><textarea id="koText" rows="5" placeholder="Ex. : agrandir le logo de 2 cm, remplacer le bleu par le Pantone 286 C…"></textarea></label>
        <div class="drop" id="koDrop" style="margin-top:12px;padding:14px">${icon("upload", "sm")} Joindre un fichier (logo, croquis…)</div><div id="koFiles" class="row" style="margin-top:8px"></div>`,
      actions: [{ label: "Annuler" }, { label: "Envoyer la demande", cls: "primary", icon: "send", onClick: async mm => {
        const comment = $("#koText", mm).value.trim();
        if (!comment) throw new Error("Décrivez les modifications souhaitées.");
        D = await call("POST", `/bats/${last.id}/reject`, { comment, files, name: D.client?.contact || "" });
        render(); toast("Demande envoyée. Nous revenons vers vous avec une nouvelle version.");
      } }],
    });
    bindDrop($("#koDrop", m.el), async fl => {
      for (const f of fl) { try { files.push(await upload(f)); } catch (e) { fail(e); } }
      $("#koFiles", m.el).innerHTML = files.map(f => `<span class="chip">${icon("file", "sm")} ${h(f.name)}</span>`).join("");
    });
  });
}

/* ---------- Messagerie ---------- */
function renderMessages() {
  const sec = $("#msgSec");
  let staged = [];
  sec.innerHTML = `<div class="msgs" id="thread" style="max-height:340px;overflow:auto">${D.messages.map(m => `<div class="msg ${m.from === "client" ? "me" : ""}">${h(m.text)}${(m.files || []).map(f => `<div><a href="${h(f.url)}" target="_blank">📎 ${h(f.name || "fichier")}</a></div>`).join("")}<div class="when">${m.from === "client" ? "Vous" : h(D.company?.name || "Atelier")} · ${fmtDate(m.at, true)}</div></div>`).join("")
      || `<small class="muted">Une question, un logo à nous transmettre ? Écrivez-nous ici.</small>`}</div>
    <textarea id="mText" rows="3" style="margin-top:12px" placeholder="Votre message…"></textarea>
    <div id="mFiles" class="row" style="margin-top:6px"></div>
    <div class="row" style="margin-top:8px"><button class="btn sm" id="mAttach">${icon("upload", "sm")} Joindre un logo / fichier</button><span class="spacer"></span><button class="btn primary" id="mSend">${icon("send", "sm")} Envoyer</button></div>`;
  const th = $("#thread"); th.scrollTop = th.scrollHeight;
  const drawFiles = () => $("#mFiles").innerHTML = staged.map(f => `<span class="chip">${icon("file", "sm")} ${h(f.name)}</span>`).join("");
  $("#mAttach").onclick = () => {
    if (PREVIEW) return toast("Aperçu : action désactivée", "err");
    const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = "image/*,application/pdf";
    i.onchange = async () => { for (const f of i.files) { try { toast(`Envoi de ${f.name}…`); staged.push(await upload(f)); drawFiles(); } catch (e) { fail(e); } } };
    i.click();
  };
  $("#mSend").onclick = async () => {
    if (PREVIEW) return toast("Aperçu : action désactivée", "err");
    const text = $("#mText").value.trim();
    if (!text && !staged.length) return;
    try { D = await call("POST", "/messages", { text, files: staged }); renderMessages(); toast("Message envoyé"); } catch (e) { fail(e); }
  };
}

/* ---------- Actions devis ---------- */
function acceptQuote() {
  if (PREVIEW) return toast("Aperçu : action désactivée", "err");
  signModal({
    title: `Accepter le devis ${D.number}`,
    intro: `En signant, vous acceptez le devis d'un montant de <b>${fmtEUR(D.totals.ttc)} TTC</b> ainsi que les conditions générales indiquées.`,
    cta: "Bon pour accord",
    onSubmit: async data => { D = await call("POST", "/accept", data); render(); toast("Merci ! Votre devis est accepté."); scrollTo({ top: 0, behavior: "smooth" }); },
  });
}
function declineQuote() {
  if (PREVIEW) return toast("Aperçu : action désactivée", "err");
  modal({
    title: "Décliner le devis",
    body: `<label class="f"><span>Pouvez-vous nous dire pourquoi ? (facultatif)</span><textarea id="dc" rows="4" placeholder="Prix, délai, autre prestataire…"></textarea></label>`,
    actions: [{ label: "Annuler" }, { label: "Décliner", cls: "danger", onClick: async m => { D = await call("POST", "/decline", { comment: $("#dc", m).value }); render(); } }],
  });
}
async function payDeposit() {
  if (PREVIEW) return toast("Aperçu : action désactivée", "err");
  try { const r = await call("POST", "/deposit"); location.href = r.url; } catch (e) { fail(e); }
}

/* ---------- Version imprimable ---------- */
function renderPrint() {
  const co = D.company || {}, c = D.client || {}, T = D.totals;
  document.title = `Devis ${D.number}`;
  root.innerHTML = `<div class="doc">
    <div class="hdr"><div>${co.logo ? `<img src="${h(co.logo)}" style="max-height:60px;max-width:200px;margin-bottom:10px"><br>` : ""}<b style="font-size:14px">${h(co.name)}</b><br>
      ${h(co.address)}<br>${h([co.zip, co.city].filter(Boolean).join(" "))}<br>${h([co.phone, co.email].filter(Boolean).join(" · "))}${co.website ? `<br>${h(co.website)}` : ""}</div>
      <div style="text-align:right"><h1>DEVIS</h1><div style="margin-top:6px">N° <b>${h(D.number)}</b><br>Date : ${fmtDate(D.createdAt)}<br>Valable jusqu'au : ${fmtDate(D.validUntil)}</div>
      <div class="box" style="text-align:left;margin-top:14px"><small class="muted">Client</small><br><b>${h(c.company || c.contact)}</b><br>${c.company && c.contact ? h(c.contact) + "<br>" : ""}${h(c.address)}${c.address ? "<br>" : ""}${h([c.zip, c.city].filter(Boolean).join(" "))}${c.vatNumber ? `<br>${h(c.vatNumber)}` : ""}</div></div></div>
    ${D.title ? `<p><b>Objet :</b> ${h(D.title)}</p>` : ""}
    <table class="t"><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">PU HT</th><th class="r">Total HT</th></tr></thead><tbody>
    ${D.lines.map(l => `<tr><td><b>${h(l.name)}</b>${l.color ? ` — ${h(l.color)}` : ""}${l.ref ? ` <span class="muted">(${h(l.ref)})</span>` : ""}
      <div class="muted" style="font-size:11px">${l.sizes.map(s => `${h(s.size)}×${s.qty}`).join(", ")}</div>
      ${l.persos.map(p => `<div style="font-size:11px">◆ ${h(p.technique)} — ${h(p.position || "")}${p.w && p.h ? ` · ${p.w}×${p.h} cm` : ` · ${h(p.format)}`}${p.colors ? ` · ${p.colors} coul.` : ""}</div>`).join("")}
      ${l.note ? `<div style="font-size:11px;font-style:italic">${h(l.note)}</div>` : ""}</td>
      <td class="r num">${l.qty}</td><td class="r num">${fmtEUR(l.unit)}</td><td class="r num">${fmtEUR(l.total)}</td></tr>`).join("")}
    ${D.setups.map(s => `<tr><td>${h(s.label)}</td><td class="r">1</td><td class="r num">${fmtEUR(s.amount)}</td><td class="r num">${fmtEUR(s.amount)}</td></tr>`).join("")}
    ${D.fees.map(f => `<tr><td>${h(f.label)}</td><td class="r">${f.qty}</td><td class="r num">${fmtEUR(f.unit)}</td><td class="r num">${fmtEUR(f.total)}</td></tr>`).join("")}
    </tbody></table>
    <div class="tot">${totalsHtml(T)}${T.deposit ? `<div class="sum-row" style="color:var(--muted)"><span>Acompte ${T.depositPct} %</span><span class="num">${fmtEUR(T.deposit)}</span></div>` : ""}</div>
    <div class="grid g2" style="margin-top:24px;align-items:start">
      <div>${D.leadTime ? `<b>Délai :</b> ${h(D.leadTime)}<br>` : ""}${D.notes ? `<div style="white-space:pre-wrap;margin-top:6px">${h(D.notes)}</div>` : ""}
        ${co.iban ? `<div style="margin-top:8px"><b>Règlement par virement</b><br>IBAN : ${h(co.iban)}${co.bic ? `<br>BIC : ${h(co.bic)}` : ""}</div>` : ""}</div>
      <div class="box" style="min-height:110px"><small class="muted">Bon pour accord — date et signature</small>
        ${D.acceptance ? `<div style="margin-top:6px">Signé par <b>${h(D.acceptance.name)}</b> le ${fmtDate(D.acceptance.at, true)}</div><img src="${h(D.acceptance.signature)}" style="max-height:70px;max-width:100%">` : ""}</div>
    </div>
    ${D.conditions ? `<div class="foot" style="white-space:pre-wrap">${h(D.conditions)}</div>` : ""}
    <div class="foot" style="text-align:center">${h([co.name, co.siret ? `SIRET ${co.siret}` : "", co.vatNumber ? `TVA ${co.vatNumber}` : ""].filter(Boolean).join(" · "))}</div>
  </div>
  <div class="row no-print" style="justify-content:center;margin-bottom:30px"><button class="btn primary" onclick="print()">${icon("print")} Imprimer / Enregistrer en PDF</button></div>`;
  const imgs = $$("img", root);
  Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => print(), 300));
}

/* ---------- Démarrage ---------- */
(async () => {
  try {
    if (!TOKEN) throw new Error("Lien incomplet.");
    const paid = params.get("paid");
    if (paid && !PREVIEW) {
      try { D = await call("POST", "/deposit/confirm", { sessionId: paid }); toast("Paiement de l'acompte reçu, merci !"); }
      catch (e) { fail(e); }
      history.replaceState(null, "", `?t=${encodeURIComponent(TOKEN)}`);
    }
    D ||= await call("GET", "");
    if (!PREVIEW) call("POST", "/view").catch(() => {});
    render();
  } catch (e) {
    root.innerHTML = `<div class="login"><div class="card" style="text-align:center"><div class="empty"><div class="ico">${icon("alert")}</div><b>${h(e.message)}</b><p>Contactez l'atelier pour obtenir un nouveau lien.</p></div></div></div>`;
  }
})();
