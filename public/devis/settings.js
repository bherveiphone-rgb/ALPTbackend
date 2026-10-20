/* Paramètres : entreprise, calcul, emails (connexion + modèles), automatisations, formulaire, intégrations, sauvegarde. */
import { S, api, h, $, $$, icon, badge, toast, fail, confirmBox, modal, fmtDate, num, uid, uploadFile, pickFiles, readAsText, download } from "./ui.js";
import { reloadBootstrap } from "./app.js";

const TABS = [["entreprise", "users", "Entreprise"], ["calcul", "calc", "Devis & calcul"], ["emails", "send", "Boîte mail"], ["modeles", "msg", "Modèles d'emails"],
  ["automatisations", "sparkle", "Automatisations"], ["formulaire", "link", "Formulaire & portail"], ["prospection", "trend", "Prospection"], ["integrations", "euro", "Pennylane & Qonto"], ["utilisateurs", "lock", "Utilisateurs"], ["sauvegarde", "download", "Sauvegarde"]];

export function renderSettings(main) {
  const tab = location.hash.split("/")[2] || "entreprise";
  const st = structuredClone(S.settings);
  main.innerHTML = `<div class="page-head"><div class="grow"><h1>Paramètres</h1><p>Vos informations, règles de calcul, emails et automatisations.</p></div>
    <button class="btn primary" id="save">${icon("save")} Enregistrer</button></div>
    <div class="settings-tabs">${TABS.map(([k, ic, l]) => `<button data-t="${k}" class="${tab === k ? "on" : ""}">${icon(ic, "sm")} ${l}</button>`).join("")}</div>
    <div id="sb"></div>`;
  $$(".settings-tabs button").forEach(b => b.onclick = () => { location.hash = `#/parametres/${b.dataset.t}`; });
  const body = $("#sb");
  const draw = { entreprise, calcul, emails, modeles, automatisations, formulaire, prospection, integrations, utilisateurs, sauvegarde }[tab] || entreprise;
  let collect = () => {};
  /** Enregistre ; `rerender=false` garde la page affichée (boutons « tester »). Lève en cas d'erreur. */
  const save = async (rerender = true) => {
    collect();
    for (const el of $$("[data-k]", body)) {
      const path = el.dataset.k.split(".");
      let v = el.type === "checkbox" ? el.checked : el.type === "number" ? num(el.value) : el.value;
      if (el.dataset.list) v = el.value.split("\n").map(s => s.trim()).filter(Boolean);
      if (el.dataset.nums) v = el.value.split(/[,; ]+/).map(Number).filter(n => n > 0).sort((a, b) => a - b);
      let o = st;
      for (const p of path.slice(0, -1)) o = o[p] ||= {};
      o[path[path.length - 1]] = v;
    }
    await api("PUT", "/settings", st);
    await reloadBootstrap();
    toast("Paramètres enregistrés");
    if (rerender) renderSettings(main);
  };
  collect = draw(body, st, save) || (() => {});
  $("#save").onclick = () => save().catch(fail);
}

const f = (k, l, v, t = "text", extra = "") => `<label class="f"><span>${l}</span><input type="${t}" data-k="${k}" value="${h(v ?? "")}" ${extra}></label>`;
const chk = (k, l, v, extra = "") => `<label class="check"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""} ${extra}> ${l}</label>`;
const card = (title, inner, right = "") => `<div class="card"><div class="card-h"><h2>${title}</h2>${right}</div><div class="card-b">${inner}</div></div>`;

/* -------- Entreprise -------- */
function entreprise(body, st) {
  const co = st.company;
  body.innerHTML = `<div class="grid g2" style="align-items:start">${card("Mon entreprise", `
    <div class="row" style="margin-bottom:14px"><div class="thumb" style="width:72px;height:72px" id="logoPrev">${co.logo ? `<img src="${h(co.logo)}">` : icon("image")}</div>
      <div><button class="btn sm" id="logoBtn">${icon("upload", "sm")} Logo</button> ${co.logo ? `<button class="btn sm ghost" id="logoDel">Retirer</button>` : ""}<div class="hint">Affiché sur les devis, le portail et le formulaire client.</div></div></div>
    <div class="grid g2">
      ${f("company.name", "Raison sociale", co.name)}${f("company.contactName", "Votre prénom et nom", co.contactName)}
      ${f("company.address", "Adresse", co.address)}${f("company.zip", "Code postal", co.zip)}
      ${f("company.city", "Ville", co.city)}${f("company.siret", "SIRET", co.siret)}
      ${f("company.email", "Email", co.email, "email")}${f("company.phone", "Téléphone", co.phone, "tel")}
      ${f("company.website", "Site web", co.website)}${f("company.vatNumber", "N° TVA intracom.", co.vatNumber)}
      ${f("company.iban", "IBAN (acompte par virement)", co.iban)}${f("company.bic", "BIC", co.bic)}
    </div>`)}
    <div class="stack">${card("Textes affichés aux clients", `<div class="stack">
      <label class="f"><span>Conditions générales (sur chaque devis)</span><textarea data-k="conditions" rows="6">${h(st.conditions)}</textarea></label>
      <label class="f"><span>Délai de production par défaut</span><input type="text" data-k="leadTime" value="${h(st.leadTime)}"></label>
      <label class="f"><span>Signature des emails</span><textarea data-k="emailSignature" rows="4" placeholder="Camille Martin&#10;Atelier Textile Perso — 06 00 00 00 00">${h(st.emailSignature)}</textarea></label></div>`)}
    ${card("Étiquettes de contacts", `<textarea data-k="tags" data-list="1" rows="4">${h((st.tags || []).join("\n"))}</textarea><div class="hint">Une par ligne : Club, Entreprise, École…</div>`)}</div></div>`;
  $("#logoBtn").onclick = async () => {
    const [file] = await pickFiles({ accept: "image/*", multiple: false });
    if (!file) return;
    try { const r = await uploadFile(file); co.logo = r.url; $("#logoPrev").innerHTML = `<img src="${h(r.url)}">`; toast("Logo chargé — pensez à enregistrer"); } catch (e) { fail(e); }
  };
  if ($("#logoDel")) $("#logoDel").onclick = () => { co.logo = ""; $("#logoPrev").innerHTML = icon("image"); };
}

/* -------- Calcul -------- */
function calcul(body, st) {
  body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="stack">${card("Calcul & devis", `<div class="grid g2">
      <label class="f"><span>Coefficient textile par défaut</span><div class="input-group"><input type="number" step="0.05" data-k="defaultCoef" value="${h(st.defaultCoef)}"><span class="addon">× achat</span></div></label>
      <label class="f"><span>TVA</span><div class="input-group"><input type="number" step="0.1" data-k="vatRate" value="${h(st.vatRate)}"><span class="addon">%</span></div></label>
      <label class="f"><span>Validité des devis</span><div class="input-group"><input type="number" data-k="validityDays" value="${h(st.validityDays)}"><span class="addon">jours</span></div></label>
      <label class="f"><span>Acompte demandé</span><div class="input-group"><input type="number" data-k="depositPct" value="${h(st.depositPct)}"><span class="addon">% TTC</span></div></label>
      <label class="f"><span>Délai de paiement des factures</span><div class="input-group"><input type="number" data-k="paymentTermsDays" value="${h(st.paymentTermsDays ?? 30)}"><span class="addon">jours</span></div></label>
      <div></div>
      ${f("quotePrefix", "Préfixe de numérotation", st.quotePrefix)}${f("nextNumber", "Prochain numéro de devis", st.nextNumber, "number")}</div>`)}
    ${card("Remises dégressives textile", `<p class="hint" style="margin-top:0">Remise automatique sur le textile selon la quantité de la ligne.</p><div id="discs"></div>`, `<button class="btn sm" id="addDisc">${icon("plus", "sm")}</button>`)}
    ${card("Étapes de production", st.productionStages.map((s, i) => `<label class="f" style="margin-bottom:8px"><span>Étape ${i + 1}</span><input type="text" data-stage="${s.key}" value="${h(s.label)}"></label>`).join(""))}
    </div><div class="stack">
    ${card("Emplacements de marquage", `<textarea data-k="positions" data-list="1" rows="6">${h((st.positions || []).join("\n"))}</textarea>`)}
    ${card("Frais annexes prédéfinis", `<div id="fees"></div>`, `<button class="btn sm" id="addFee">${icon("plus", "sm")}</button>`)}
    ${card("Contrôles du BAT", `<textarea data-k="batChecklist" data-list="1" rows="5">${h((st.batChecklist || []).join("\n"))}</textarea><div class="hint">Le client doit cocher chaque point avant de signer le BAT.</div>`)}
    ${card("Raisons de perte", `<textarea data-k="lostReasons" data-list="1" rows="4">${h((st.lostReasons || []).join("\n"))}</textarea>`)}
    ${card("Paiement en ligne", `${chk("onlinePayment", "Proposer le paiement de l'acompte par carte (Stripe)", st.onlinePayment, S.stripeEnabled ? "" : "disabled")}${S.stripeEnabled ? "" : `<div class="hint">Nécessite STRIPE_SECRET_KEY dans le fichier .env.</div>`}`)}
    </div></div>`;
  const drawDiscs = () => {
    $("#discs").innerHTML = (st.textileDiscounts || []).map((d, i) => `<div class="row" style="margin-bottom:8px"><span>Dès</span><input type="number" class="sm" style="width:90px" data-d="${i}" data-f="min" value="${h(d.min)}"><span>pièces :</span>
      <div class="input-group" style="width:110px"><input type="number" class="sm" step="0.5" data-d="${i}" data-f="pct" value="${h(d.pct)}"><span class="addon">%</span></div><button class="btn sm ghost icon" data-dd="${i}">${icon("trash", "sm")}</button></div>`).join("") || `<small class="muted">Aucune.</small>`;
    $$("[data-d]").forEach(i => i.oninput = () => st.textileDiscounts[i.dataset.d][i.dataset.f] = num(i.value) ?? 0);
    $$("[data-dd]").forEach(b => b.onclick = () => { st.textileDiscounts.splice(b.dataset.dd, 1); drawDiscs(); });
  };
  const drawFees = () => {
    $("#fees").innerHTML = (st.extraFees || []).map((x, i) => `<div class="row" style="margin-bottom:8px;flex-wrap:nowrap"><input type="text" class="sm" data-fe="${i}" data-f="label" value="${h(x.label)}">
      <div class="input-group" style="width:120px;flex:none"><input type="number" class="sm" step="0.01" data-fe="${i}" data-f="unit" value="${h(x.unit)}"><span class="addon">€</span></div>
      <label class="check" style="flex:none"><input type="checkbox" data-fe="${i}" data-f="perPiece" ${x.perPiece ? "checked" : ""}><small>/pièce</small></label><button class="btn sm ghost icon" data-fd="${i}">${icon("trash", "sm")}</button></div>`).join("");
    $$("[data-fe]").forEach(i => i.oninput = () => st.extraFees[i.dataset.fe][i.dataset.f] = i.type === "checkbox" ? i.checked : i.type === "number" ? num(i.value) ?? 0 : i.value);
    $$("[data-fd]").forEach(b => b.onclick = () => { st.extraFees.splice(b.dataset.fd, 1); drawFees(); });
  };
  drawDiscs(); drawFees();
  $("#addDisc").onclick = () => { (st.textileDiscounts ||= []).push({ min: 100, pct: 5 }); drawDiscs(); };
  $("#addFee").onclick = () => { (st.extraFees ||= []).push({ id: uid("f"), label: "", unit: 0, perPiece: false }); drawFees(); };
  return () => {
    st.textileDiscounts = (st.textileDiscounts || []).filter(d => d.min > 0).sort((a, b) => a.min - b.min);
    st.extraFees = (st.extraFees || []).filter(x => x.label);
    st.productionStages = st.productionStages.map(s => ({ ...s, label: $(`[data-stage="${s.key}"]`)?.value || s.label }));
  };
}

/* -------- Boîte mail -------- */
function emails(body, st, save) {
  const m = st.mail || { smtp: {}, imap: {} };
  const ms = S.mailState || {};
  body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="stack">
    ${card("Connexion de votre boîte mail", `
      <p style="margin-top:0" class="muted">Les emails (devis, BAT, relances, prospection) partent de <b>votre adresse</b>, et l'outil lit votre boîte de réception pour rattacher automatiquement les réponses à la bonne fiche client et arrêter les relances de prospection.</p>
      <label class="f"><span>Fournisseur</span><select id="preset"><option value="">Choisir pour pré-remplir…</option>${Object.entries(S.mailPresets || {}).map(([k, p]) => `<option value="${k}">${h(p.label)}</option>`).join("")}</select></label>
      <div id="phelp" class="hint"></div>
      <div class="grid g2" style="margin-top:10px">
        ${f("mail.smtp.user", "Adresse email (identifiant)", m.smtp?.user, "email", 'autocomplete="off"')}
        <label class="f"><span>Mot de passe ${m.hasSmtpPass ? badge("enregistré", "success", true) : ""}</span><input type="password" data-k="mail.smtp.pass" value="" placeholder="${m.hasSmtpPass ? "•••••••• (inchangé)" : "mot de passe d'application"}" autocomplete="new-password"></label>
        ${f("mail.smtp.from", "Nom et adresse d'expédition", m.smtp?.from, "text", 'placeholder="Atelier Dupont <contact@atelier.fr>"')}
        <div></div>
        ${f("mail.smtp.host", "Serveur SMTP (envoi)", m.smtp?.host)}${f("mail.smtp.port", "Port SMTP", m.smtp?.port || 587, "number")}
        ${chk("mail.smtp.secure", "Connexion SSL directe (port 465)", m.smtp?.secure)}<div></div>
        ${chk("mail.imap.enabled", "<b>Lire les emails reçus</b> (IMAP)", m.imap?.enabled)}<div></div>
        ${f("mail.imap.host", "Serveur IMAP (réception)", m.imap?.host)}${f("mail.imap.port", "Port IMAP", m.imap?.port || 993, "number")}
      </div>
      <p class="hint">Le mot de passe IMAP est le même que celui d'envoi. Avec Gmail, utilisez un <b>mot de passe d'application</b> (compte Google › Sécurité › Validation en 2 étapes › Mots de passe des applications).</p>
      <div class="row" style="margin-top:12px"><input type="email" id="testTo" class="sm" style="width:240px" placeholder="Envoyer un email de test à…" value="${h(st.company.email || m.smtp?.user || "")}"><button class="btn" id="test">${icon("send", "sm")} Enregistrer et tester</button></div>
      <div id="testRes" style="margin-top:10px"></div>`)}
    </div><div class="stack">
    ${card("État", `<dl class="kv"><dt>Envoi</dt><dd>${S.mailEnabled ? badge("Connecté", "success") : badge("Non configuré", "neutral")}</dd>
      <dt>Réception</dt><dd>${S.imapEnabled ? badge("Activée", "success") : badge("Désactivée", "neutral")}${ms.lastPoll ? ` <small class="muted">dernière relève ${new Date(ms.lastPoll).toLocaleString("fr-FR")}</small>` : ""}</dd>
      ${ms.lastError ? `<dt>Erreur</dt><dd style="color:var(--danger)">${h(ms.lastError)}</dd>` : ""}</dl>
      <p class="hint">Relève des emails toutes les 3 minutes. Seuls les nouveaux messages (après la connexion) sont analysés. Les emails de vos contacts, clients et prospects sont rattachés à leur fiche ; les autres apparaissent dans Demandes › « Emails non rattachés ».</p>`)}
    ${card("Notifications", `${f("notifyEmail", "M'alerter à cette adresse (demande, devis accepté, BAT validé, message…)", st.notifyEmail, "email", `placeholder="${h(st.company.email || "vous@exemple.fr")}"`)}`)}
    </div></div>`;
  $("#preset").onchange = e => {
    const p = S.mailPresets[e.target.value]; if (!p) return;
    const set = (k, v) => { const el = $(`[data-k="${k}"]`); if (el.type === "checkbox") el.checked = v; else el.value = v; };
    set("mail.smtp.host", p.smtp.host); set("mail.smtp.port", p.smtp.port); set("mail.smtp.secure", p.smtp.secure);
    set("mail.imap.host", p.imap.host); set("mail.imap.port", p.imap.port); set("mail.imap.enabled", true);
    $("#phelp").innerHTML = p.help ? `${icon("alert", "sm")} ${h(p.help)}` : "";
  };
  $("#test").onclick = async () => {
    $("#testRes").innerHTML = `<small class="muted">Test en cours…</small>`;
    try {
      await save(false);
      const r = await api("POST", "/mail/test", { to: $("#testTo")?.value || "" });
      const line = (l, x) => x ? `<div>${x.ok ? "✅" : "❌"} ${l}${x.ok ? "" : ` : ${h(x.error)}`}</div>` : "";
      $("#testRes").innerHTML = line("Envoi (SMTP)", r.smtp) + line("Réception (IMAP)", r.imap) + (r.sent ? `<div>📨 Email de test envoyé.</div>` : "");
    } catch (e) { $("#testRes").innerHTML = `<div style="color:var(--danger)">${h(e.message)}</div>`; }
  };
}

/* -------- Modèles -------- */
function modeles(body, st) {
  const VARS = ["contact", "client", "numero", "objet", "lien", "montant_ht", "montant_ttc", "acompte", "date_limite", "version", "transporteur", "suivi", "lien_suivi", "atelier", "signature"];
  body.innerHTML = `<div class="banner t-info">${icon("msg")}<div class="grow">Variables disponibles : ${VARS.map(v => `<code style="font-size:11.5px">{{${v}}}</code>`).join(" ")}</div></div>
    <div class="grid g2" style="align-items:start">${Object.entries(st.templates).map(([k, t]) => card(h(t.label), `
      <input type="text" data-k="templates.${k}.subject" value="${h(t.subject)}">
      <textarea data-k="templates.${k}.body" rows="8" style="margin-top:8px">${h(t.body)}</textarea>`)).join("")}</div>`;
}

/* -------- Automatisations -------- */
function automatisations(body, st) {
  const A = st.automation;
  const row = (title, desc, inner) => `<div style="padding:12px 0;border-bottom:1px solid var(--border)"><b>${title}</b><div class="hint" style="margin:2px 0 8px">${desc}</div><div class="row">${inner}</div></div>`;
  const n = (k, v, w = 70) => `<input type="number" class="sm" style="width:${w}px" data-k="automation.${k}" value="${h(v)}">`;
  body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h2>Suivi commercial</h2>${chk("automation.enabled", "Automatisations actives", A.enabled)}</div><div class="card-b">
    ${row("Relance des devis sans réponse", "Après l'envoi, si le client n'a ni accepté ni refusé. Sinon une tâche « Relancer » vous est proposée.", `<span>Après</span><input type="text" class="sm" style="width:90px" data-k="automation.quoteReminderDays" data-nums="1" value="${h((A.quoteReminderDays || []).join(", "))}"><span>jours</span>${chk("automation.autoSendQuoteReminders", "envoyer l'email automatiquement", A.autoSendQuoteReminders)}`)}
    ${row("Devis bientôt expiré", "Crée une tâche quelques jours avant la fin de validité.", `<span>Prévenir</span>${n("expiringDays", A.expiringDays)}<span>jours avant</span>`)}
    ${row("Demande non traitée", "Délai pour répondre à une nouvelle demande (échéance de la tâche).", n("requestResponseHours", A.requestResponseHours) + "<span>heures</span>")}
    ${row("Relance « nouvelle saison »", "Environ un an après la dernière commande d'un client : proposer de la reconduire (email « Relance avant la saison » ou tâche).", `<span>Après</span>${n("seasonWeeks", A.seasonWeeks)}<span>semaines</span>${chk("automation.autoSendSeason", "envoyer l'email automatiquement", A.autoSendSeason)}`)}
    ${row("Clients à recontacter", "Tâche si un client n'a rien commandé depuis… (renouvellement de saison).", n("reactivationMonths", A.reactivationMonths) + "<span>mois</span>")}
    ${row("Emails d'inconnus", "Créer automatiquement une demande quand un inconnu écrit au sujet d'un devis, d'un prix…", chk("automation.inboundToRequest", "activer", A.inboundToRequest))}
  </div></div>
  <div class="card"><div class="card-h"><h2>Commande & livraison</h2></div><div class="card-b">
    ${row("Relance du BAT", "Si le client n'a pas validé le BAT.", `<span>Après</span>${n("batReminderDays", A.batReminderDays)}<span>jours</span>${chk("automation.autoSendBatReminders", "envoyer l'email automatiquement", A.autoSendBatReminders)}`)}
    ${row("Acompte non reçu", "Après acceptation du devis.", `<span>Après</span>${n("depositReminderDays", A.depositReminderDays)}<span>jours</span>${chk("automation.autoSendDepositReminders", "envoyer l'email automatiquement", A.autoSendDepositReminders)}`)}
    ${row("Alerte délai", "Tâche prioritaire quand la date souhaitée par le client approche et que la commande n'est pas expédiée.", n("deadlineWarningDays", A.deadlineWarningDays) + "<span>jours avant</span>")}
    ${row("Emails de suivi au client", "Production lancée, commande expédiée (avec n° de suivi) ou prête au retrait.", chk("automation.autoStatusEmails", "prévenir le client automatiquement", A.autoStatusEmails))}
    ${row("Avis après livraison", "Demande d'avis (note + commentaire) sur l'espace client. Les avis ≤ 3/5 créent une tâche de rappel.", `<span>Après</span>${n("reviewAfterDays", A.reviewAfterDays)}<span>jours</span>${chk("automation.autoSendReview", "envoyer automatiquement", A.autoSendReview)}`)}
    <div class="row" style="margin-top:14px"><button class="btn" id="runNow">${icon("refresh", "sm")} Lancer les vérifications maintenant</button><span class="hint" id="runRes">Vérification automatique toutes les 10 minutes.</span></div>
  </div></div></div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Journal des actions automatiques</h2></div><div id="alog" class="card-b"><small class="muted">Chargement…</small></div></div>`;
  $("#runNow").onclick = async () => { try { const r = await api("POST", "/automation/run"); $("#runRes").textContent = `${r.tasks} tâche(s) créée(s), ${r.emails} email(s) envoyé(s)${r.mails ? `, ${r.mails} email(s) reçu(s) traités` : ""}.`; } catch (e) { fail(e); } };
  api("GET", "/automation/log").then(l => { $("#alog").innerHTML = l.length ? l.slice(0, 50).map(x => `<div style="font-size:13px;padding:4px 0">${new Date(x.at).toLocaleString("fr-FR")} — ${h(x.text)}</div>`).join("") : `<small class="muted">Aucune action pour l'instant.</small>`; }).catch(() => {});
}

/* -------- Formulaire & portail -------- */
function formulaire(body, st) {
  const link = `${(st.publicUrl || location.origin).trim().replace(/\/$/, "")}/devis/demande.html`;
  body.innerHTML = `${card("Adresse publique de l'outil", `
    <p style="margin-top:0">Adresse utilisée dans <b>tous les liens envoyés à vos clients</b> (devis, BAT, formulaire, désinscription). Indispensable si l'outil tourne sur votre ordinateur : collez ici l'adresse donnée par le tunnel (ex. <code>https://devis.mon-atelier.fr</code>).</p>
    ${f("publicUrl", "Adresse publique", st.publicUrl, "url", 'placeholder="https://devis.mon-atelier.fr"')}
    ${/^(localhost|127\.)/.test(location.hostname) && !st.publicUrl ? `<div class="warn-list">Sans adresse publique, vos clients ne pourront pas ouvrir les liens reçus (ils pointent vers « localhost », votre ordinateur).</div>` : ""}`)}
  <div class="grid g2" style="align-items:start;margin-top:16px">${card("Formulaire de demande de devis", `
    <p style="margin-top:0">Vos clients décrivent leur besoin, joignent leur logo et indiquent emplacements et dimensions. Chaque demande crée une fiche contact, une tâche et vous alerte.</p>
    <div class="input-group"><input readonly value="${h(link)}"><a class="btn" href="${h(link)}" target="_blank" style="border-radius:0 8px 8px 0">Ouvrir</a></div>
    <label class="f" style="margin-top:12px"><span>Texte d'introduction du formulaire</span><textarea data-k="formIntro" rows="3" placeholder="Ex. : Devis gratuit sous 24 h — clubs, associations, entreprises.">${h(st.formIntro)}</textarea></label>
    <div class="section-lbl" style="margin-top:12px">Intégration sur votre site</div><div class="code-box">${h(`<iframe src="${link}?embed=1" style="width:100%;min-height:1400px;border:0"></iframe>`)}</div>`)}
    ${card("Portail client", `<p style="margin-top:0">Chaque devis a un lien personnel : consultation, PDF, signature électronique, validation du BAT, messagerie, suivi de fabrication et d'expédition, avis.</p>
    <p class="hint">Conseil : ajoutez le lien du formulaire dans votre signature d'email (Paramètres › Entreprise).</p>`)}</div>`;
}

/* -------- Prospection -------- */
function prospection(body, st) {
  const P = st.prospection;
  body.innerHTML = `<div class="grid g2" style="align-items:start">${card("Rythme d'envoi", `<div class="grid g2">
      <label class="f"><span>Maximum par jour</span><input type="number" data-k="prospection.dailyLimit" value="${h(P.dailyLimit)}"></label>
      <label class="f"><span>Intervalle minimum</span><div class="input-group"><input type="number" data-k="prospection.minGapMinutes" value="${h(P.minGapMinutes)}"><span class="addon">min</span></div></label>
      <label class="f"><span>De</span><div class="input-group"><input type="number" data-k="prospection.startHour" value="${h(P.startHour)}"><span class="addon">h</span></div></label>
      <label class="f"><span>À</span><div class="input-group"><input type="number" data-k="prospection.endHour" value="${h(P.endHour)}"><span class="addon">h</span></div></label>
      ${chk("prospection.weekdaysOnly", "Uniquement en semaine", P.weekdaysOnly)}</div>
      <p class="hint">Recommandé : 30 à 50 emails/jour depuis une boîte classique (Gmail limite à ~500/jour, mais un volume régulier et modéré évite d'être classé en spam).</p>`)}
    ${card("Pied de page obligatoire", `<textarea data-k="prospection.footer" rows="4">${h(P.footer)}</textarea><p class="hint">Doit contenir <code>{{desinscription}}</code> (lien de désinscription en un clic). Prospection B2B en France : adresses professionnelles uniquement, objet en lien avec l'activité du destinataire, identité de l'expéditeur claire, droit d'opposition respecté.</p>`)}</div>`;
  return () => { if (!/\{\{\s*desinscription\s*\}\}/.test($('[data-k="prospection.footer"]').value)) throw new Error("Le pied de page doit contenir {{desinscription}}."); };
}

/* -------- Pennylane -------- */
function integrations(body, st, save) {
  const pl = st.pennylane || {};
  body.innerHTML = `<div class="grid g2" style="align-items:start">${card("Pennylane", `
    <p style="margin-top:0">Créez vos factures d'acompte et de solde depuis l'onglet Facturation : le client est créé dans Pennylane, les lignes du devis sont reprises, et les paiements reviennent automatiquement (synchronisation toutes les 30 min).</p>
    <label class="f"><span>Clé d'API ${pl.hasKey ? badge("enregistrée", "success", true) : ""}</span><input type="password" data-k="pennylane.apiKey" value="" placeholder="${pl.hasKey ? "•••••••• (inchangée)" : "Collez votre jeton d'API"}" autocomplete="new-password"></label>
    <div style="margin-top:10px">${chk("pennylane.draft", "Créer les factures en <b>brouillon</b> (recommandé : vous les vérifiez puis les finalisez dans Pennylane)", pl.draft !== false)}</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="plTest">${icon("refresh", "sm")} Enregistrer et tester</button><span id="plRes"></span></div>`)}
    ${card("Obtenir la clé", `<ol style="margin:0;padding-left:18px;line-height:1.7"><li>Dans Pennylane : <b>Paramètres › Connectivité › Développeurs</b>.</li><li>Créez un jeton d'API (API v2) avec les droits <b>Factures clients</b> et <b>Clients</b> en lecture/écriture.</li><li>Collez-le ici et testez.</li></ol>
      <p class="hint">Le jeton est stocké sur votre serveur et n'est jamais renvoyé au navigateur. Vous pouvez aussi le définir via PENNYLANE_API_KEY dans le fichier .env.</p>`)}
    ${card("Qonto (banque)", `
      <p style="margin-top:0">Les <b>virements reçus</b> sont relevés toutes les 15 minutes et rapprochés de vos devis : par la référence (ex. DEV-2026-0012, indiquée au client sur son devis), sinon par le montant et le nom. Connexion en <b>lecture seule</b> : aucun paiement ne peut être émis.</p>
      <div class="grid g2">${f("qonto.login", "Identifiant", st.qonto?.login, "text", 'placeholder="mon-atelier-1234" autocomplete="off"')}
      <label class="f"><span>Clé secrète ${st.qonto?.hasKey ? badge("enregistrée", "success", true) : ""}</span><input type="password" data-k="qonto.secretKey" value="" placeholder="${st.qonto?.hasKey ? "•••••••• (inchangée)" : "Clé secrète"}" autocomplete="new-password"></label></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="qtTest">${icon("refresh", "sm")} Enregistrer et tester</button><span id="qtRes"></span></div>`)}
    ${card("Obtenir la clé Qonto", `<ol style="margin:0;padding-left:18px;line-height:1.7"><li>Dans l'application Qonto (titulaire ou admin) : <b>Paramètres › Intégrations et partenariats › Clé API</b>.</li><li>Copiez l'<b>identifiant</b> et la <b>clé secrète</b>.</li><li>Collez-les ici et testez.</li></ol>`)}</div>`;
  $("#qtTest").onclick = async () => {
    try { await save(false); const r = await api("POST", "/qonto/test"); $("#qtRes").innerHTML = `✅ ${h(r.name)} — ${r.accounts.length} compte(s)`; }
    catch (e) { $("#qtRes").innerHTML = `<span style="color:var(--danger)">❌ ${h(e.message)}</span>`; }
  };
  $("#plTest").onclick = async () => {
    try { await save(false); const r = await api("POST", "/pennylane/test"); $("#plRes").innerHTML = `✅ Connecté${r.company ? ` à ${h(r.company)}` : ""}`; }
    catch (e) { $("#plRes").innerHTML = `<span style="color:var(--danger)">❌ ${h(e.message)}</span>`; }
  };
}

/* -------- Utilisateurs -------- */
function utilisateurs(body) {
  const draw = async () => {
    let users = [];
    try { users = await api("GET", "/users"); } catch (e) { return fail(e); }
    body.innerHTML = card("Comptes utilisateurs", `<p style="margin-top:0">Chaque personne se connecte avec son email et son mot de passe. Le mot de passe principal (ADMIN_PASSWORD, email vide) reste toujours valable.</p>
      <ul class="hint" style="margin-top:0"><li><b>Administrateur</b> : accès complet.</li><li><b>Employé</b> : devis, contacts, demandes, production, planning, achats, stock — sans prix d'achat, coefficients ni marges, et sans accès aux paramètres, tarifs, facturation et statistiques.</li></ul>
      <table class="t"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr data-u="${u.id}" class="${u.active ? "" : "muted"}"><td><b>${h(u.name)}</b>${u.active ? "" : " (désactivé)"}</td><td>${h(u.email)}</td><td>${badge(S.roles?.[u.role] || u.role, u.role === "admin" ? "violet" : "info")}</td>
        <td class="muted">${u.lastLoginAt ? fmtDate(u.lastLoginAt, true) : "jamais"}</td><td class="r"><button class="btn sm" data-ed>${icon("pen", "sm")} Modifier</button></td></tr>`).join("")
        || `<tr><td colspan="5" class="empty">Aucun compte. Créez un compte pour chaque collaborateur.</td></tr>`}</tbody></table>`,
      `<button class="btn primary sm" id="nu">${icon("plus", "sm")} Ajouter</button>`);
    $("#nu").onclick = () => userModal({}, draw);
    $$("[data-u]", body).forEach(r => { $("[data-ed]", r).onclick = () => userModal(users.find(u => u.id === r.dataset.u), draw); });
  };
  draw();
}
function userModal(u, done) {
  const isNew = !u.id;
  modal({
    title: isNew ? "Nouveau compte" : `Modifier ${u.name}`,
    body: `<div class="grid g2"><label class="f"><span>Nom</span><input type="text" id="un" value="${h(u.name)}"></label>
      <label class="f"><span>Email</span><input type="email" id="ue" value="${h(u.email)}"></label>
      <label class="f"><span>Rôle</span><select id="ur">${Object.entries(S.roles || { admin: "Administrateur", employe: "Employé" }).map(([k, l]) => `<option value="${k}" ${k === (u.role || "employe") ? "selected" : ""}>${h(l)}</option>`).join("")}</select></label>
      <label class="f"><span>${isNew ? "Mot de passe" : "Nouveau mot de passe"}</span><input type="text" id="up" autocomplete="new-password" placeholder="${isNew ? "8 caractères minimum" : "laisser vide pour ne pas changer"}"></label></div>
      ${isNew ? "" : `<label class="check" style="margin-top:10px"><input type="checkbox" id="ua" ${u.active ? "checked" : ""}> Compte actif</label>`}
      <p class="hint">Communiquez le mot de passe à la personne ; elle se connecte sur la même adresse que vous.</p>`,
    actions: [...(isNew ? [] : [{ label: "Supprimer", cls: "danger ghost", onClick: async () => {
      if (!(await confirmBox(`Supprimer le compte de ${u.name} ?`, "La personne ne pourra plus se connecter.", { danger: true, label: "Supprimer" }))) return false;
      await api("DELETE", `/users/${u.id}`); done();
    } }]), { label: "Annuler" }, { label: "Enregistrer", cls: "primary", onClick: async el => {
      const b = { name: $("#un", el).value, email: $("#ue", el).value, role: $("#ur", el).value };
      if ($("#up", el).value) b.password = $("#up", el).value;
      if (!isNew) b.active = $("#ua", el).checked;
      await api(isNew ? "POST" : "PUT", isNew ? "/users" : `/users/${u.id}`, b);
      toast("Compte enregistré"); done();
    } }],
  });
}

/* -------- Sauvegarde -------- */
function sauvegarde(body) {
  body.innerHTML = card("Sauvegarde", `<p style="margin-top:0">Exporte toutes les données (devis, contacts, demandes, tâches, prospects, tarifs, paramètres — hors mots de passe). Pensez à sauvegarder régulièrement le dossier <code>data/</code> et <code>uploads/</code> du serveur.</p>
    <div class="row"><button class="btn" id="bk">${icon("download")} Exporter toutes les données</button><button class="btn" id="rs">${icon("upload")} Restaurer</button></div>`);
  $("#bk").onclick = async () => { try { download(`sauvegarde-atelier-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await api("GET", "/backup"), null, 2), "application/json"); } catch (e) { fail(e); } };
  $("#rs").onclick = async () => {
    const [file] = await pickFiles({ accept: "application/json,.json", multiple: false });
    if (!file) return;
    if (!(await confirmBox("Restaurer la sauvegarde ?", "Toutes les données actuelles seront remplacées (les connexions email et Pennylane sont conservées).", { label: "Restaurer", danger: true }))) return;
    try { await api("POST", "/restore", JSON.parse(await readAsText(file))); toast("Données restaurées"); location.reload(); } catch (e) { fail(e); }
  };
}
