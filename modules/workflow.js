/* Workflow commande → livraison : tableau de production, automatisations planifiées
   (relances, rappels, alertes délais, avis) et traitement des emails entrants (IMAP). */
import { uid, clean, normEmail, DAY } from "./core.js";

const STAGES = ["a_lancer", "commande", "marquage", "controle", "expedie", "livre"];

export function workflowRoutes(router, ctx) {
  const { db, requireAdmin, wrap } = ctx;

  /* ================= PRODUCTION ================= */
  router.get("/production", requireAdmin, (_req, res) => {
    const quotes = db.get("quotes").filter(q => q.production || (["accepte", "production", "expedie"].includes(q.status)));
    res.json(quotes.map(q => ({
      ...ctx.quoteSummary(q),
      lines: (q.computed?.lines || []).map(l => ({ name: l.name, color: l.color, qty: l.qty, image: l.image, kind: l.kind, persos: l.persos.map(p => `${p.techniqueName} ${p.position}`) })),
      batValidated: (q.bats || []).some(b => b.status === "valide"),
    })));
  });

  router.patch("/quotes/:id/production", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    const b = req.body || {};
    const p = q.production ||= { stage: "a_lancer", since: Date.now(), mode: "expedition" };
    const prev = p.stage;
    for (const k of ["carrier", "tracking", "trackingUrl", "notes"]) if (k in b) p[k] = clean(b[k], 500);
    if (b.mode === "retrait" || b.mode === "expedition") p.mode = b.mode;
    if ("dueDate" in b) q.deadline = Number(b.dueDate) || null;
    const emails = [];
    if (b.stage && STAGES.includes(b.stage) && b.stage !== prev) {
      p.stage = b.stage; p.since = Date.now();
      const label = db.get("settings").productionStages.find(s => s.key === b.stage)?.label || b.stage;
      ctx.logQuote(q, "production", `Production : ${label}`);
      ctx.addActivity({ type: "system", clientId: q.clientId, quoteId: q.id, text: `${q.number} → ${label}` });
      if (b.stage !== "a_lancer" && ["accepte", "envoye", "brouillon"].includes(q.status)) {
        q.status = "production";
        q.acceptedAt ||= Date.now();
      }
      if (prev === "a_lancer" && !p.startedAt) {
        p.startedAt = Date.now();
        ctx.completeTasks(`quote:${q.id}:launch`);
        if (b.notify) emails.push("production_started");
      }
      if (b.stage === "expedie") {
        q.status = "expedie"; p.shippedAt = Date.now();
        if (b.notify) emails.push(p.mode === "retrait" ? "ready_pickup" : "shipped");
      }
      if (b.stage === "livre") {
        q.status = "livre"; p.deliveredAt = Date.now();
        ctx.completeTasks(`quote:${q.id}:`);
      }
    }
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    const sent = [];
    for (const key of emails) if (await ctx.sendQuoteTemplate(q, key, req)) sent.push(key);
    if (sent.length) db.update("quotes", qs => { const x = qs.find(y => y.id === q.id); ctx.logQuote(x, "email", `Client prévenu par email (${sent.map(k => db.get("settings").templates[k].label).join(", ")})`); });
    res.json({ ...ctx.quoteSummary(q), mailed: sent });
  }));

  /* ================= AUTOMATISATIONS ================= */
  router.get("/automation/log", requireAdmin, (_req, res) => res.json(db.get("autolog").slice(-200).reverse()));
  router.post("/automation/run", requireAdmin, wrap(async (req, res) => {
    const r = await runAutomations(ctx, req);
    let mails = 0;
    if (ctx.mail.imapConfigured()) mails = await ctx.mail.poll(m => handleInbound(ctx, m));
    res.json({ ...r, mails });
  }));

  /* ================= EMAILS ENTRANTS NON RATTACHÉS ================= */
  router.get("/inbox", requireAdmin, (_req, res) => res.json(db.get("inbox").filter(m => !m.archived).slice(-200).reverse()));
  router.post("/inbox/:id/:action(archive|request|contact)", requireAdmin, wrap((req, res) => {
    const m = db.get("inbox").find(x => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: "Email introuvable" });
    let out = {};
    if (req.params.action === "request") {
      const r = ctx.createRequest({ contact: { email: m.from, contact: m.fromName }, subject: m.subject, message: m.text.slice(0, 8000), consent: true }, { source: "email" });
      out = { requestId: r.id };
    } else if (req.params.action === "contact") {
      const c = ctx.ensureClient({ email: m.from, contact: m.fromName }, { type: "prospect", source: "email" });
      ctx.addActivity({ type: "email_in", clientId: c.id, text: `Email reçu : « ${m.subject} »`, subject: m.subject, body: m.text.slice(0, 4000), at: m.date });
      out = { clientId: c.id };
    }
    db.update("inbox", l => { const x = l.find(y => y.id === m.id); if (x) x.archived = true; });
    res.json({ ok: true, ...out });
  }));
}

/* ------------------------------------------------------------------ */
function autolog(ctx, text, extra = {}) {
  ctx.db.update("autolog", l => { l.push({ id: uid("al"), at: Date.now(), text, ...extra }); if (l.length > 1000) l.splice(0, l.length - 1000); });
}

/** Passe en revue devis, BAT, paiements et livraisons ; crée des tâches ou envoie les relances prévues. */
export async function runAutomations(ctx, req) {
  const { db, mail } = ctx;
  const s = db.get("settings");
  const A = s.automation;
  const now = Date.now();
  const out = { emails: 0, tasks: 0 };
  if (!A.enabled) return out;
  const canMail = mail.configured();
  const quotes = db.get("quotes");
  const toSend = []; // [quote, templateKey, historyText]
  const task = t => { if (ctx.addTask({ auto: true, ...t })) out.tasks++; };
  const who = q => q.client?.company || q.client?.contact || "client";

  for (const q of quotes) {
    // 1. Relances de devis sans réponse
    if (q.status === "envoye" && q.sentAt && !(q.validUntil && now > q.validUntil)) {
      q.reminders ||= [];
      // une seule relance par passage : la plus récente échue (les précédentes sont considérées faites)
      const due = (A.quoteReminderDays || []).map((d, i) => [d, i]).filter(([d, i]) => now - q.sentAt >= d * DAY && !q.reminders.includes(i));
      const top = due.length ? due[due.length - 1][1] : -1;
      if (top >= 0 && !q.reminders.some(x => x > top)) {
        for (let i = 0; i <= top; i++) if (!q.reminders.includes(i)) q.reminders.push(i);
        const days = Math.floor((now - q.sentAt) / DAY);
        if (A.autoSendQuoteReminders && canMail && q.client?.email) toSend.push([q, "quote_reminder", `Relance automatique n°${top + 1} envoyée`]);
        else task({ key: `quote:${q.id}:remind:${top}`, title: `Relancer ${who(q)} — devis ${q.number} envoyé il y a ${days} j sans réponse`, quoteId: q.id, clientId: q.clientId });
      }
    }
    // 2. Devis bientôt expiré
    if (q.status === "envoye" && q.validUntil && q.validUntil > now && q.validUntil - now < (A.expiringDays || 2) * DAY) {
      task({ key: `quote:${q.id}:expire`, title: `Le devis ${q.number} (${who(q)}) expire le ${new Date(q.validUntil).toLocaleDateString("fr-FR")}`, quoteId: q.id, clientId: q.clientId });
    }
    // 3. BAT en attente de validation
    const lastBat = (q.bats || [])[q.bats?.length - 1];
    if (lastBat?.status === "en_attente" && !lastBat.reminded && now - lastBat.createdAt >= (A.batReminderDays || 2) * DAY) {
      lastBat.reminded = now;
      if (A.autoSendBatReminders && canMail && q.client?.email) toSend.push([q, "bat_reminder", `Rappel automatique : BAT V${lastBat.version} en attente`]);
      else task({ key: `quote:${q.id}:batremind:${lastBat.id}`, title: `Relancer ${who(q)} pour valider le BAT ${q.number}`, quoteId: q.id, clientId: q.clientId });
    }
    // 4. Acompte non reçu
    const accepted = q.acceptedAt || q.acceptance?.at;
    const depositDue = (q.computed?.totals?.deposit || 0) > 0 && !q.depositPayment?.paid && !["acompte", "paye"].includes(q.payment?.status);
    if (["accepte", "production"].includes(q.status) && accepted && depositDue && !q.depositReminded && now - accepted >= (A.depositReminderDays || 3) * DAY) {
      q.depositReminded = now;
      if (A.autoSendDepositReminders && canMail && q.client?.email) toSend.push([q, "deposit_reminder", "Rappel automatique d'acompte envoyé"]);
      else task({ key: `quote:${q.id}:deposit`, title: `Acompte non reçu — ${q.number} (${who(q)})`, quoteId: q.id, clientId: q.clientId });
    }
    // 5. Date souhaitée par le client qui approche
    if (q.deadline && q.production && !["expedie", "livre"].includes(q.production.stage) && q.deadline - now < (A.deadlineWarningDays || 5) * DAY) {
      const late = q.deadline < now;
      task({ key: `quote:${q.id}:deadline`, title: `${late ? "⚠ EN RETARD" : "Délai serré"} : ${q.number} attendu le ${new Date(q.deadline).toLocaleDateString("fr-FR")}`, quoteId: q.id, clientId: q.clientId, priority: "high", due: Math.min(now, q.deadline) });
    }
    // 6. Demande d'avis après livraison
    if (q.status === "livre" && q.production?.deliveredAt && !q.reviewRequested && !q.review && now - q.production.deliveredAt >= (A.reviewAfterDays || 3) * DAY) {
      q.reviewRequested = now;
      if (A.autoSendReview && canMail && q.client?.email) toSend.push([q, "review_request", "Demande d'avis envoyée"]);
    }
  }
  db.set("quotes", quotes);

  for (const [q, key, text] of toSend) {
    if (await ctx.sendQuoteTemplate(q, key, req)) {
      out.emails++;
      db.update("quotes", qs => { const x = qs.find(y => y.id === q.id); if (x) ctx.logQuote(x, "auto", text); });
      autolog(ctx, `${q.number} — ${text}`, { quoteId: q.id });
    }
  }

  // 7. Clients à recontacter (pas de commande depuis N mois)
  if (A.reactivationMonths) {
    const limit = A.reactivationMonths * 30 * DAY;
    const year = new Date().getFullYear();
    for (const c of db.get("clients").filter(c => c.type === "client")) {
      const qs = quotes.filter(q => q.clientId === c.id);
      const lastOrder = Math.max(0, ...qs.filter(q => ["accepte", "production", "expedie", "livre"].includes(q.status)).map(q => q.acceptedAt || q.updatedAt));
      const open = qs.some(q => ["brouillon", "envoye", "accepte", "production"].includes(q.status));
      if (lastOrder && !open && now - lastOrder > limit) {
        task({ key: `client:${c.id}:reactivate:${year}`, title: `Recontacter ${c.company || c.contact} : dernière commande le ${new Date(lastOrder).toLocaleDateString("fr-FR")}`, clientId: c.id });
      }
    }
  }
  if (out.tasks) autolog(ctx, `${out.tasks} tâche(s) de suivi créée(s)`);
  return out;
}

/** Rattache un email reçu au bon contact / devis / prospect. */
export async function handleInbound(ctx, m) {
  const { db } = ctx;
  const s = db.get("settings");
  const own = new Set([normEmail(ctx.mail.cfg().smtp.from.match(/<([^>]+)>/)?.[1] || ctx.mail.cfg().smtp.from), normEmail(ctx.mail.cfg().smtp.user), normEmail(s.company.email)]);
  if (!m.from || own.has(m.from)) return;
  const snippet = m.text.replace(/\n>.*$/gs, "").trim().slice(0, 4000);

  // Prospect qui répond → on arrête la séquence
  const prospects = db.get("prospects");
  const p = prospects.find(x => normEmail(x.email) === m.from);
  if (p) {
    const stop = /d[ée]sinscri|ne plus recevoir|unsubscribe|retirez[- ]moi|stop/i.test(`${m.subject} ${snippet.slice(0, 300)}`);
    if (!m.autoReply) {
      p.status = stop ? "desinscrit" : (p.status === "converti" ? p.status : "repondu");
      p.nextAt = null; p.repliedAt = m.date;
      if (stop) db.update("optout", l => { if (!l.some(o => o.email === m.from)) l.push({ email: m.from, at: Date.now(), reason: "réponse STOP" }); });
      else ctx.addTask({ key: `prospect:${p.id}:reply:${m.uid}`, title: `${p.company || p.contact} a répondu à votre prospection : « ${m.subject} »`, prospectId: p.id, clientId: p.clientId || null, auto: true, priority: "high" });
      db.set("prospects", prospects);
    }
    ctx.addActivity({ type: "email_in", prospectId: p.id, clientId: p.clientId || null, text: `${m.autoReply ? "Réponse automatique" : "Réponse"} de ${m.from} : « ${m.subject} »`, subject: m.subject, body: snippet, at: m.date });
    return;
  }

  const c = ctx.findClientByEmail(m.from);
  const quotes = db.get("quotes");
  const num = `${m.subject} ${snippet.slice(0, 500)}`.match(/[A-Z]{2,5}-\d{4}-\d{4}/)?.[0];
  let q = num && quotes.find(x => x.number === num);
  if (!q && c) q = quotes.filter(x => x.clientId === c.id && !["livre", "refuse", "annule"].includes(x.status)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const r = num && db.get("requests").find(x => x.number === num);
  if (c || q || r) {
    ctx.addActivity({ type: "email_in", clientId: c?.id || q?.clientId || r?.clientId || null, quoteId: q?.id || null, requestId: r?.id || null, text: `Email reçu de ${m.from} : « ${m.subject} »`, subject: m.subject, body: snippet, at: m.date });
    if (q) {
      const x = quotes.find(y => y.id === q.id);
      x.attention = true;
      ctx.logQuote(x, "email", `Email reçu : « ${m.subject} »`);
      db.set("quotes", quotes);
    }
    if (!m.autoReply) ctx.addTask({ key: `email:${m.uid}`, title: `Répondre à l'email de ${c?.company || c?.contact || m.from} : « ${m.subject} »`, clientId: c?.id || null, quoteId: q?.id || null, requestId: r?.id || null, auto: true });
    return;
  }

  // Inconnu : nouvelle demande si activé et si ça ressemble à une demande de devis, sinon boîte « non rattachés »
  if (!m.autoReply && s.automation.inboundToRequest && /devis|tarif|prix|commande|personnalis|flocage|broderie|s[ée]rigraphie/i.test(`${m.subject} ${snippet.slice(0, 1000)}`)) {
    ctx.createRequest({ contact: { email: m.from, contact: m.fromName }, subject: m.subject, message: snippet, consent: true }, { source: "email" });
    autolog(ctx, `Demande créée depuis un email de ${m.from}`);
    return;
  }
  if (!m.autoReply) db.update("inbox", l => { l.push({ id: uid("in"), at: Date.now(), date: m.date, from: m.from, fromName: m.fromName, subject: m.subject, text: snippet }); if (l.length > 500) l.splice(0, l.length - 500); });
}

/** Planificateur : automatisations (10 min), relève IMAP (3 min), envois de prospection (1 min). */
export function startScheduler(ctx) {
  if (process.env.DISABLE_SCHEDULER === "1") return;
  let n = 0, busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true; n++;
    try {
      if (n % 10 === 1) await runAutomations(ctx);
      if (n % 3 === 1 && ctx.mail.imapConfigured()) await ctx.mail.poll(m => handleInbound(ctx, m));
      if (n % 30 === 5 && ctx.pennylaneSync) await ctx.pennylaneSync();
      if (n % 15 === 7 && ctx.qontoEnabled?.()) await ctx.qontoSync().catch(e => ctx.db.set("bankstate", { ...ctx.db.get("bankstate"), lastError: e.message, lastSync: Date.now() }));
      if (ctx.prospectionTick) await ctx.prospectionTick();
    } catch (e) { console.error("Planificateur :", e.message); }
    busy = false;
  }, 60_000);
  timer.unref?.();
}
