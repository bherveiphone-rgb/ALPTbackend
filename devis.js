/* ============================================================
   OUTIL DEVIS · BAT · CRM · PRODUCTION · PROSPECTION
   - API admin   : /api/devis/...            (en-tête x-admin-password)
   - API client  : /api/devis/public/...     (liens secrets / formulaire public)
   Persistance en fichiers JSON dans /data, fichiers dans /uploads.
   ============================================================ */
import express from "express";
import fs from "fs";
import { computeQuote, batStatusOf, QUOTE_STATUSES, fmtEUR, r2 } from "./public/devis/pricing.js";
import { makeStore } from "./modules/store.js";
import { createMail, MAIL_PRESETS } from "./modules/mail.js";
import { createCore, uid, token, clean, saveDataUrl, cleanFiles, normEmail } from "./modules/core.js";
import { SEED_SETTINGS, SEED_TECHNIQUES, SEED_CATALOG, SEED_SEQUENCES, SEED_TECHNIQUES_V2, SEED_OBJECTS, mergeSettings } from "./modules/seeds.js";
import { crmRoutes } from "./modules/crm.js";
import { workflowRoutes, startScheduler } from "./modules/workflow.js";
import { pennylaneRoutes } from "./modules/pennylane.js";
import { prospectionRoutes } from "./modules/prospection.js";
import { qontoRoutes } from "./modules/qonto.js";
import { purchasingRoutes } from "./modules/purchasing.js";
import { shopRoutes } from "./modules/shops.js";
import { setupAccounts, ROLES } from "./modules/accounts.js";
import { atelierRoutes } from "./modules/atelier.js";

const SEEDS = {
  settings: SEED_SETTINGS, techniques: SEED_TECHNIQUES, catalog: SEED_CATALOG, clients: [], quotes: [],
  activities: [], tasks: [], requests: [], prospects: [], sequences: SEED_SEQUENCES, optout: [], mailstate: {}, inbox: [], autolog: [], prospstate: {},
  quoteTemplates: [], bankmatches: [], bankstate: {}, stock: [], stockmoves: [], shops: [], shopOrders: [], users: [], sessions: [],
};

export function createDevisRouter({ dataDir, uploadsDir, adminPassword, stripe }) {
  const db = makeStore(dataDir, SEEDS, { mergeSettings });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  // Migration v2 : ajoute les tarifs d'exemple objets & print sans toucher à vos données
  if ((db.get("settings").seedVersion || 1) < 2) {
    db.update("techniques", l => { for (const t of SEED_TECHNIQUES_V2) if (!l.some(x => x.id === t.id)) l.push(structuredClone(t)); });
    db.update("catalog", l => { for (const a of SEED_OBJECTS) if (!l.some(x => x.id === a.id)) l.push(structuredClone(a)); });
    db.update("settings", s => { s.seedVersion = 2; });
  }
  const mail = createMail(db);
  const ctx = createCore({ db, mail, adminPassword });
  ctx.uploadsDir = uploadsDir;
  ctx.stripe = stripe;
  const accountRoutes = setupAccounts(ctx, adminPassword);
  const { requireAdmin, wrap, logQuote: log } = ctx;

  const router = express.Router();
  router.use(express.json({ limit: "40mb" }));
  router.use(ctx.trackOrigin);
  accountRoutes(router);

  /* -------- Calcul : les techniques figées dans le devis priment -------- */
  const techsFor = q => {
    const global = db.get("techniques");
    const snap = q.techSnapshot || {};
    const ids = new Set([...global.map(t => t.id), ...Object.keys(snap)]);
    return [...ids].map(id => snap[id] || global.find(t => t.id === id)).filter(Boolean);
  };
  ctx.techsFor = techsFor;
  function recompute(q, settings = db.get("settings")) {
    const global = db.get("techniques");
    q.techSnapshot ||= {};
    for (const l of q.lines || []) for (const p of l.perso || []) {
      if (!q.techSnapshot[p.techniqueId]) {
        const t = global.find(x => x.id === p.techniqueId);
        if (t) q.techSnapshot[p.techniqueId] = structuredClone(t);
      }
    }
    q.computed = computeQuote(q, techsFor(q), settings);
    return q;
  }
  ctx.recompute = recompute;

  function summary(q) {
    return {
      id: q.id, number: q.number, title: q.title, status: q.status, batStatus: batStatusOf(q),
      client: { company: q.client?.company || "", contact: q.client?.contact || "", email: q.client?.email || "" },
      clientId: q.clientId || null, requestId: q.requestId || null, createdAt: q.createdAt, updatedAt: q.updatedAt, sentAt: q.sentAt || null,
      acceptedAt: q.acceptance?.at || q.acceptedAt || null, viewedAt: q.viewedAt || null, validUntil: q.validUntil, deadline: q.deadline || null,
      attention: !!q.attention, totals: q.computed?.totals || {}, depositPaid: !!q.depositPayment?.paid,
      batCount: (q.bats || []).length, lineCount: (q.lines || []).length,
      production: q.production || null, payment: q.payment || { status: "non_paye" }, invoices: q.invoices || [],
      review: q.review ? { rating: q.review.rating } : null, lostReason: q.lostReason || "",
    };
  }
  ctx.quoteSummary = summary;
  const withLink = (q, req) => ({ ...q, link: ctx.clientLink(q, req), techniques: techsFor(q) });
  const findQuote = (quotes, id) => {
    const q = quotes.find(x => x.id === id);
    if (!q) throw Object.assign(new Error("Devis introuvable"), { status: 404 });
    return q;
  };
  /** Rattache le devis à la fiche contact correspondant à son email (CRM). */
  const linkClient = q => {
    if (!q.clientId && q.client?.email) { const c = ctx.findClientByEmail(q.client.email); if (c) q.clientId = c.id; }
  };

  /* ================= ADMIN ================= */
  const publicSettings = s => ({
    ...s,
    mail: { ...s.mail, smtp: { ...s.mail.smtp, pass: "" }, imap: { ...s.mail.imap, pass: "" }, hasSmtpPass: !!s.mail.smtp?.pass, hasImapPass: !!s.mail.imap?.pass },
    pennylane: { ...s.pennylane, apiKey: "", hasKey: !!(s.pennylane.apiKey || process.env.PENNYLANE_API_KEY) },
    qonto: { ...s.qonto, secretKey: "", hasKey: !!(s.qonto.secretKey || process.env.QONTO_SECRET_KEY) },
  });
  router.get("/bootstrap", requireAdmin, (req, res) => {
    const s = db.get("settings");
    res.json({
      user: req.user, roles: ROLES,
      settings: publicSettings(s), techniques: db.get("techniques"), catalog: db.get("catalog"), clients: db.get("clients"),
      mailEnabled: mail.configured(), imapEnabled: mail.imapConfigured(), mailPresets: MAIL_PRESETS, mailState: db.get("mailstate"),
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY, qontoEnabled: !!(s.qonto.login || process.env.QONTO_LOGIN) && !!(s.qonto.secretKey || process.env.QONTO_SECRET_KEY), pennylaneEnabled: !!(s.pennylane.apiKey || process.env.PENNYLANE_API_KEY),
    });
  });

  router.put("/settings", requireAdmin, (req, res) => {
    const cur = db.get("settings");
    const b = req.body || {};
    const next = { ...cur, ...b, company: { ...cur.company, ...(b.company || {}) } };
    // les secrets ne sont jamais renvoyés au navigateur : champ vide = on garde l'ancien
    if (b.mail) {
      next.mail = {
        ...cur.mail, ...b.mail,
        smtp: { ...cur.mail.smtp, ...(b.mail.smtp || {}), pass: b.mail.smtp?.pass || cur.mail.smtp?.pass || "" },
        imap: { ...cur.mail.imap, ...(b.mail.imap || {}), pass: b.mail.imap?.pass || cur.mail.imap?.pass || "" },
      };
      delete next.mail.hasSmtpPass; delete next.mail.hasImapPass;
    }
    if (b.qonto) { next.qonto = { ...cur.qonto, ...b.qonto, secretKey: b.qonto.secretKey || cur.qonto.secretKey || "" }; delete next.qonto.hasKey; }
    if (b.pennylane) { next.pennylane = { ...cur.pennylane, ...b.pennylane, apiKey: b.pennylane.apiKey || cur.pennylane.apiKey || "" }; delete next.pennylane.hasKey; }
    db.set("settings", next);
    res.json(publicSettings(mergeSettings(next)));
  });

  router.post("/mail/test", requireAdmin, wrap(async (req, res) => {
    const out = await mail.verify();
    if (out.smtp?.ok && req.body?.to) {
      try { await mail.send({ to: req.body.to, subject: "Test de connexion — outil Devis & BAT", text: "Votre boîte mail est bien connectée à l'outil. 🎉" }); out.sent = true; }
      catch (e) { out.smtp = { ok: false, error: e.message }; }
    }
    res.json(out);
  }));

  // CRUD générique pour références et techniques (les contacts sont gérés par le module CRM)
  for (const coll of ["catalog", "techniques"]) {
    router.get(`/${coll}`, requireAdmin, (_req, res) => res.json(db.get(coll)));
    router.post(`/${coll}`, requireAdmin, (req, res) => {
      const item = db.update(coll, list => {
        const it = { ...req.body, id: req.body.id && !list.some(x => x.id === req.body.id) ? req.body.id : uid(coll[0]) };
        list.push(it); return it;
      });
      res.json(item);
    });
    router.put(`/${coll}/:id`, requireAdmin, (req, res) => {
      const item = db.update(coll, list => {
        const i = list.findIndex(x => x.id === req.params.id);
        if (i === -1) return null;
        list[i] = { ...list[i], ...req.body, id: list[i].id };
        return list[i];
      });
      item ? res.json(item) : res.status(404).json({ error: "Élément introuvable" });
    });
    router.delete(`/${coll}/:id`, requireAdmin, (req, res) => { db.set(coll, db.get(coll).filter(x => x.id !== req.params.id)); res.json({ ok: true }); });
    router.put(`/${coll}`, requireAdmin, (req, res) => {
      if (!Array.isArray(req.body)) return res.status(400).json({ error: "Tableau attendu" });
      const list = req.body.map(x => ({ ...x, id: x.id || uid(coll[0]) }));
      db.set(coll, list);
      res.json(list);
    });
  }

  router.post("/upload", requireAdmin, wrap((req, res) => {
    res.json({ ...saveDataUrl(uploadsDir, req.body?.dataUrl), name: clean(req.body?.name, 200) });
  }));

  /* -------- Devis -------- */
  router.get("/quotes", requireAdmin, (_req, res) => {
    res.json(db.get("quotes").map(summary).sort((a, b) => b.updatedAt - a.updatedAt));
  });

  router.get("/quotes/:id", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    if (q.attention) { q.attention = false; db.set("quotes", quotes); }
    res.json(withLink(q, req));
  }));

  const EDITABLE = ["title", "clientId", "client", "lines", "fees", "discountPct", "shipping", "vatRate", "depositPct",
    "validUntil", "leadTime", "notes", "internalNotes", "setupOverrides", "status", "deadline", "requestId", "files", "lostReason", "choices"];
  const pick = body => Object.fromEntries(EDITABLE.filter(k => k in body).map(k => [k, body[k]]));

  const nextNumber = settings => `${settings.quotePrefix || "DEV"}-${new Date().getFullYear()}-${String(settings.nextNumber || 1).padStart(4, "0")}`;
  /** Crée un devis (utilisé aussi par le module CRM pour convertir une demande). */
  ctx.createQuote = (preset = {}) => {
    const settings = db.get("settings");
    const q = {
      id: uid("q"), token: token(), number: nextNumber(settings),
      createdAt: Date.now(), updatedAt: Date.now(), status: "brouillon", title: "", client: {}, clientId: null,
      lines: [], fees: [], discountPct: 0, shipping: 0, vatRate: settings.vatRate, depositPct: settings.depositPct,
      validUntil: Date.now() + (settings.validityDays || 30) * 864e5, leadTime: settings.leadTime, notes: "", internalNotes: "",
      setupOverrides: {}, bats: [], history: [], messages: [], files: [], deadline: null, ...pick(preset),
    };
    q.status = "brouillon";
    linkClient(q);
    log(q, "create", preset.requestId ? "Devis créé à partir d'une demande" : "Devis créé");
    recompute(q, settings);
    db.update("quotes", list => list.push(q));
    db.set("settings", { ...db.get("settings"), nextNumber: (settings.nextNumber || 1) + 1 });
    return q;
  };

  router.post("/quotes", requireAdmin, (req, res) => {
    const b = req.body || {};
    if (ctx.isEmployee(req) && Array.isArray(b.lines)) {
      const tpl = db.get("quoteTemplates").find(t => t.id === b.templateId);
      ctx.restoreCosts(b.lines, tpl ? tpl.lines.map((l, i) => ({ ...l, id: b.lines[i]?.id })) : []);
    }
    res.json(withLink(ctx.createQuote(b), req));
  });

  router.put("/quotes/:id", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const patch = pick(req.body);
    if (patch.lines && ctx.isEmployee(req)) ctx.restoreCosts(patch.lines, q.lines);
    if (patch.status && patch.status !== q.status) {
      if (!QUOTE_STATUSES[patch.status]) return res.status(400).json({ error: "Statut invalide" });
      log(q, "status", `Statut changé : ${QUOTE_STATUSES[q.status]?.label} → ${QUOTE_STATUSES[patch.status].label}`);
      if (["accepte", "production", "expedie", "livre"].includes(patch.status) && !q.acceptedAt) q.acceptedAt = Date.now();
      if (patch.status === "refuse") ctx.completeTasks(`quote:${q.id}:`);
    }
    Object.assign(q, patch, { updatedAt: Date.now() });
    linkClient(q);
    recompute(q);
    db.set("quotes", quotes);
    res.json(withLink(q, req));
  }));

  router.post("/quotes/:id/refresh-pricing", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const catalog = db.get("catalog");
    q.techSnapshot = {};
    for (const l of q.lines || []) {
      const a = catalog.find(x => x.id === l.articleId);
      if (a) Object.assign(l, { cost: a.cost, coef: a.coef, salePrice: a.salePrice, sizeSurcharges: a.sizeSurcharges || {}, availableSizes: a.sizes });
    }
    log(q, "pricing", "Tarifs actualisés avec les grilles en vigueur");
    q.updatedAt = Date.now();
    recompute(q);
    db.set("quotes", quotes);
    res.json(withLink(q, req));
  }));

  router.delete("/quotes/:id", requireAdmin, (req, res) => {
    db.set("quotes", db.get("quotes").filter(x => x.id !== req.params.id));
    db.update("requests", rs => rs.forEach(r => { if (r.quoteId === req.params.id) { r.quoteId = null; r.status = "en_cours"; } }));
    res.json({ ok: true });
  });

  router.post("/quotes/:id/duplicate", requireAdmin, wrap((req, res) => {
    const src = findQuote(db.get("quotes"), req.params.id);
    const copy = structuredClone(src);
    const q = ctx.createQuote({ ...copy, title: src.title ? `${src.title} (copie)` : "", requestId: null, files: [] });
    db.update("quotes", list => { const x = list.find(y => y.id === q.id); x.history = [{ id: uid("h"), at: Date.now(), type: "create", text: `Devis dupliqué depuis ${src.number}` }]; });
    res.json({ id: q.id });
  }));

  // Envoi du devis au client (marque "envoyé" + email si boîte connectée)
  router.post("/quotes/:id/send", requireAdmin, wrap(async (req, res) => {
    const before = findQuote(db.get("quotes"), req.params.id);
    const link = ctx.clientLink(before, req);
    let mailed = false;
    if (req.body?.email && req.body?.to) {
      await mail.send({ to: clean(req.body.to, 300), subject: clean(req.body.subject, 300) || `Votre devis ${before.number}`, text: clean(req.body.message, 10000) });
      mailed = true;
      ctx.addActivity({ type: "email_out", clientId: before.clientId, quoteId: before.id, text: `Devis ${before.number} envoyé par email à ${req.body.to}`, subject: clean(req.body.subject, 300) });
    }
    // relecture après l'envoi : on ne réécrit pas une version périmée du fichier
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    if (q.status === "brouillon") q.status = "envoye";
    q.sentAt = Date.now(); q.updatedAt = Date.now();
    log(q, "send", mailed ? `Devis envoyé par email à ${req.body.to}` : "Devis marqué comme envoyé (lien partagé)");
    if (q.requestId) db.update("requests", rs => { const r = rs.find(x => x.id === q.requestId); if (r) { r.status = "devis"; r.updatedAt = Date.now(); } });
    ctx.completeTasks(`request:${q.requestId}:`);
    db.set("quotes", quotes);
    res.json({ ok: true, link, mailed });
  }));

  // Nouvelle version de BAT
  router.post("/quotes/:id/bats", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const files = cleanFiles(req.body.files, 20);
    if (!files.length) return res.status(400).json({ error: "Ajoutez au moins un fichier au BAT." });
    q.bats ||= [];
    for (const b of q.bats) if (b.status === "en_attente") b.status = "remplace";
    const bat = {
      id: uid("b"), version: q.bats.length + 1, files, message: clean(req.body.message, 5000),
      specs: clean(req.body.specs, 5000), createdAt: Date.now(), status: "en_attente", response: null,
    };
    q.bats.push(bat);
    q.updatedAt = Date.now();
    log(q, "bat", `BAT V${bat.version} envoyé au client (${files.length} fichier${files.length > 1 ? "s" : ""})`);
    db.set("quotes", quotes);
    const mailed = req.body.email ? await ctx.sendQuoteTemplate(q, "bat_sent", req) : false;
    res.json({ ok: true, bat, mailed });
  }));

  router.patch("/quotes/:id/bats/:batId", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const b = q.bats?.find(x => x.id === req.params.batId);
    if (!b) return res.status(404).json({ error: "BAT introuvable" });
    if (req.body.status && ["en_attente", "valide", "modif", "remplace"].includes(req.body.status) && req.body.status !== b.status) {
      b.status = req.body.status;
      log(q, "bat", `BAT V${b.version} : statut forcé manuellement à « ${b.status} »`);
      if (b.status === "valide") ensureProduction(q);
    }
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(b);
  }));

  router.delete("/quotes/:id/bats/:batId", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    q.bats = (q.bats || []).filter(b => b.id !== req.params.batId);
    log(q, "bat", "Une version de BAT a été supprimée");
    db.set("quotes", quotes);
    res.json({ ok: true });
  }));

  router.post("/quotes/:id/messages", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const text = clean(req.body.text, 5000).trim();
    if (!text) return res.status(400).json({ error: "Message vide" });
    if (req.body.internal) log(q, "note", text);
    else (q.messages ||= []).push({ id: uid("m"), at: Date.now(), from: "atelier", text, files: cleanFiles(req.body.files) });
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    if (!req.body.internal && req.body.email && q.client?.email) {
      await mail.trySend({ to: q.client.email, subject: `Nouveau message — devis ${q.number}`, text: `${text}\n\nRépondre ou consulter votre dossier : ${ctx.clientLink(q, req)}` });
    }
    res.json(q);
  }));

  // Paiement (suivi manuel : virement, chèque…)
  router.patch("/quotes/:id/payment", requireAdmin, wrap((req, res) => {
    const quotes = db.get("quotes");
    const q = findQuote(quotes, req.params.id);
    const st = req.body.status;
    if (!["non_paye", "acompte", "paye"].includes(st)) return res.status(400).json({ error: "Statut de paiement invalide" });
    q.payment = { status: st, at: Date.now(), note: clean(req.body.note, 500), amount: req.body.amount ?? null };
    log(q, "payment", { non_paye: "Paiement : marqué non payé", acompte: "Acompte reçu", paye: "Commande soldée (payée)" }[st]);
    if (st !== "non_paye") ctx.completeTasks(`quote:${q.id}:deposit`);
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(summary(q));
  }));

  router.get("/backup", requireAdmin, (_req, res) => {
    res.setHeader("Content-Disposition", `attachment; filename="sauvegarde-devis-${new Date().toISOString().slice(0, 10)}.json"`);
    const s = db.get("settings");
    res.json({ ...Object.fromEntries(db.names().filter(n => !["mailstate", "sessions"].includes(n)).map(n => [n, db.get(n)])), settings: publicSettings(s) });
  });
  router.post("/restore", requireAdmin, (req, res) => {
    const b = req.body || {};
    for (const n of db.names()) {
      if (!(n in b) || ["mailstate", "sessions"].includes(n)) continue;
      if (n === "settings" && typeof b[n] === "object") {
        const cur = db.get("settings");
        db.set(n, { ...b[n], mail: cur.mail, pennylane: cur.pennylane, qonto: cur.qonto }); // les secrets ne sont pas dans la sauvegarde
      } else if (Array.isArray(b[n])) db.set(n, b[n]);
    }
    res.json({ ok: true });
  });

  /* ================= CLIENT (lien secret) ================= */
  function findByToken(t) {
    const quotes = db.get("quotes");
    const q = typeof t === "string" && t.length > 10 ? quotes.find(x => x.token === t) : null;
    return { quotes, q };
  }
  /** Passe un devis en « à lancer » côté production quand le BAT est validé. */
  function ensureProduction(q) {
    if (!q.production) {
      q.production = { stage: "a_lancer", since: Date.now(), mode: "expedition" };
      ctx.addTask({ key: `quote:${q.id}:launch`, title: `Lancer la production ${q.number} — ${q.client?.company || q.client?.contact || ""}`, quoteId: q.id, clientId: q.clientId, auto: true, priority: "high" });
    }
  }
  ctx.ensureProduction = ensureProduction;

  // Ne renvoie JAMAIS les prix d'achat, coefficients ou marges au client.
  function publicView(q, req) {
    const settings = db.get("settings");
    const c = q.computed || recompute(q, settings).computed;
    const { cost, margin, marginPct, ...totals } = c.totals;
    const p = q.production;
    return {
      number: q.number, title: q.title, status: q.status, createdAt: q.createdAt, validUntil: q.validUntil, deadline: q.deadline || null,
      leadTime: q.leadTime, notes: q.notes, client: q.client || {},
      company: { ...settings.company }, conditions: settings.conditions, batChecklist: settings.batChecklist,
      lines: c.lines.map(l => ({
        name: l.name, ref: l.ref, brand: l.brand, color: l.color, image: l.image, note: l.note, supplied: l.supplied, kind: l.kind,
        qty: l.qty, unit: l.unit, total: l.total, sizes: l.sizeRows.map(r => ({ size: r.size, qty: r.qty })),
        persos: l.persos.map(x => ({ technique: x.techniqueName, position: x.position, format: x.formatLabel, w: x.w, h: x.h, colors: x.colorsEnabled ? x.colors : null, design: x.design, options: x.options || [], universe: x.universe })),
      })),
      setups: c.setups.map(s => ({ label: s.label, amount: s.amount })),
      // options / variantes : le client peut choisir tant que le devis n'est pas accepté
      choosable: ["brouillon", "envoye"].includes(q.status),
      choices: (c.lines.filter(l => l.mode !== "normal").map(l => ({ id: l.id, mode: l.mode, group: l.group, included: true, name: l.name, total: l.total, deltaHt: 0 })))
        .concat((c.alternatives || []).map(a => ({ id: a.id, mode: a.mode, group: a.group, included: false, name: a.line?.name || "", total: a.line?.total || 0, deltaHt: a.deltaHt, deltaTtc: a.deltaTtc,
          line: a.line ? { name: a.line.name, color: a.line.color, image: a.line.image, qty: a.line.qty, unit: a.line.unit, note: a.line.note, kind: a.line.kind,
            persos: a.line.persos.map(x => ({ technique: x.techniqueName, position: x.position, format: x.formatLabel, w: x.w, h: x.h, colors: x.colorsEnabled ? x.colors : null, options: x.options || [] })) } : null }))),
      fees: c.fees, totals,
      acceptance: q.acceptance ? { name: q.acceptance.name, at: q.acceptance.at, signature: q.acceptance.signature } : null,
      decline: q.decline || null,
      bats: (q.bats || []).map(b => ({ id: b.id, version: b.version, files: b.files, message: b.message, specs: b.specs, createdAt: b.createdAt, status: b.status, response: b.response })),
      messages: q.messages || [], files: q.files || [],
      production: p ? { stage: p.stage, mode: p.mode, carrier: p.carrier || "", tracking: p.tracking || "", trackingUrl: p.trackingUrl || "", shippedAt: p.shippedAt || null, deliveredAt: p.deliveredAt || null } : null,
      productionStages: settings.productionStages,
      review: q.review || null,
      requestUrl: `${ctx.baseUrl(req)}/devis/demande.html`,
      deposit: {
        enabled: !!(settings.onlinePayment && process.env.STRIPE_SECRET_KEY), amount: totals.deposit,
        paid: !!q.depositPayment?.paid || ["acompte", "paye"].includes(q.payment?.status), paidAt: q.depositPayment?.at || q.payment?.at || null,
      },
    };
  }

  router.get("/public/quote/:token", (req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Ce lien n'est pas valide ou a expiré." });
    res.json(publicView(q, req));
  });

  router.post("/public/quote/:token/view", (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (!q.viewedAt) {
      log(q, "view", "Devis consulté pour la première fois par le client");
      ctx.addActivity({ type: "system", clientId: q.clientId, quoteId: q.id, text: `Devis ${q.number} consulté par le client` });
    }
    q.viewedAt = Date.now();
    q.viewCount = (q.viewCount || 0) + 1;
    db.set("quotes", quotes);
    res.json({ ok: true });
  });

  const validSignature = s => typeof s === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 400_000;

  /** Le client signe : fiche CRM créée/rattachée, tâches de relance soldées. */
  function markAccepted(q) {
    q.acceptedAt ||= Date.now();
    const c = ctx.ensureClient(q.client, { type: "client", source: "devis" });
    if (c && !q.clientId) q.clientId = c.id;
    ctx.completeTasks(`quote:${q.id}:remind`);
    ctx.completeTasks(`quote:${q.id}:expire`);
    if (q.requestId) db.update("requests", rs => { const r = rs.find(x => x.id === q.requestId); if (r) { r.status = "gagnee"; r.updatedAt = Date.now(); } });
  }

  router.post("/public/quote/:token/accept", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (["accepte", "production", "expedie", "livre"].includes(q.status)) return res.status(400).json({ error: "Ce devis est déjà accepté." });
    if (q.status === "annule") return res.status(400).json({ error: "Ce devis a été annulé." });
    if (q.validUntil && Date.now() > q.validUntil + 864e5) return res.status(400).json({ error: "Ce devis a expiré. Contactez-nous pour le réactualiser." });
    const name = clean(req.body.name, 120).trim();
    if (!name || !validSignature(req.body.signature)) return res.status(400).json({ error: "Nom et signature requis." });
    q.acceptance = { name, signature: req.body.signature, comment: clean(req.body.comment, 2000), at: Date.now(), ip: req.ip, ttc: q.computed?.totals?.ttc };
    q.status = "accepte"; q.attention = true; q.updatedAt = Date.now();
    log(q, "accept", `Devis accepté et signé par ${name} (« Bon pour accord »)`);
    markAccepted(q);
    ctx.addActivity({ type: "won", clientId: q.clientId, quoteId: q.id, text: `Devis ${q.number} accepté (${fmtEUR(q.computed?.totals?.ht)} HT) par ${name}` });
    if (!(q.bats || []).length) ctx.addTask({ key: `quote:${q.id}:bat`, title: `Préparer et envoyer le BAT — ${q.number}`, quoteId: q.id, clientId: q.clientId, auto: true, priority: "high" });
    db.set("quotes", quotes);
    ctx.notifyAdmin(`[${q.number}] Devis accepté ✅`, `${name} a accepté le devis ${q.number} (${fmtEUR(q.computed?.totals?.ttc)} TTC).`, `/devis/${q.id}`, req);
    res.json(publicView(q, req));
  }));

  router.post("/public/quote/:token/decline", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (q.status !== "envoye" && q.status !== "brouillon") return res.status(400).json({ error: "Ce devis ne peut plus être refusé en ligne." });
    q.decline = { comment: clean(req.body.comment, 2000), at: Date.now() };
    q.status = "refuse"; q.attention = true; q.updatedAt = Date.now(); q.lostReason = clean(req.body.reason, 200);
    log(q, "decline", `Devis refusé par le client${q.decline.comment ? ` : « ${q.decline.comment} »` : ""}`);
    ctx.completeTasks(`quote:${q.id}:`);
    ctx.addActivity({ type: "lost", clientId: q.clientId, quoteId: q.id, text: `Devis ${q.number} refusé${q.decline.comment ? ` : « ${q.decline.comment} »` : ""}` });
    db.set("quotes", quotes);
    ctx.notifyAdmin(`[${q.number}] Devis refusé`, q.decline.comment || "Sans commentaire", `/devis/${q.id}`, req);
    res.json(publicView(q, req));
  }));

  router.post("/public/quote/:token/bats/:batId/:action(approve|reject)", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    const b = q?.bats?.find(x => x.id === req.params.batId);
    if (!b) return res.status(404).json({ error: "BAT introuvable" });
    if (b.status !== "en_attente") return res.status(400).json({ error: "Ce BAT a déjà reçu une réponse ou a été remplacé." });
    const comment = clean(req.body.comment, 5000).trim();
    ctx.completeTasks(`quote:${q.id}:batremind`);
    if (req.params.action === "approve") {
      const name = clean(req.body.name, 120).trim();
      if (!name || !validSignature(req.body.signature)) return res.status(400).json({ error: "Nom et signature requis." });
      b.status = "valide";
      b.response = { name, signature: req.body.signature, comment, at: Date.now(), ip: req.ip };
      log(q, "bat_ok", `BAT V${b.version} validé et signé par ${name}`);
      if (q.status === "envoye" || q.status === "brouillon") {
        q.status = "accepte";
        log(q, "accept", "Devis considéré comme accepté (BAT validé)");
      }
      markAccepted(q);
      ensureProduction(q);
      ctx.addActivity({ type: "system", clientId: q.clientId, quoteId: q.id, text: `BAT V${b.version} validé par ${name}` });
      ctx.notifyAdmin(`[${q.number}] BAT V${b.version} validé ✅`, `${name} a validé le BAT.${comment ? `\nCommentaire : ${comment}` : ""}`, `/devis/${q.id}`, req);
    } else {
      if (!comment) return res.status(400).json({ error: "Merci de préciser les modifications souhaitées." });
      b.status = "modif";
      b.response = { comment, files: cleanFiles(req.body.files), at: Date.now(), name: clean(req.body.name, 120) };
      log(q, "bat_ko", `Modification demandée sur le BAT V${b.version} : « ${comment} »`);
      ctx.addTask({ key: `quote:${q.id}:batfix:${b.id}`, title: `Corriger le BAT ${q.number} : ${comment.slice(0, 120)}`, quoteId: q.id, clientId: q.clientId, auto: true, priority: "high" });
      ctx.notifyAdmin(`[${q.number}] Modification demandée sur le BAT V${b.version}`, comment, `/devis/${q.id}`, req);
    }
    q.attention = true; q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(publicView(q, req));
  }));

  router.post("/public/quote/:token/messages", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const text = clean(req.body.text, 5000).trim();
    const files = cleanFiles(req.body.files);
    if (!text && !files.length) return res.status(400).json({ error: "Message vide" });
    if ((q.messages || []).filter(m => m.from === "client" && Date.now() - m.at < 60_000).length >= 5) {
      return res.status(429).json({ error: "Trop de messages, patientez une minute." });
    }
    (q.messages ||= []).push({ id: uid("m"), at: Date.now(), from: "client", text, files });
    if (files.length) (q.files ||= []).push(...files.map(f => ({ ...f, at: Date.now(), from: "client" })));
    q.attention = true; q.updatedAt = Date.now();
    log(q, "message", `Message du client${files.length ? ` (+${files.length} fichier${files.length > 1 ? "s" : ""})` : ""}`);
    ctx.addActivity({ type: "message_in", clientId: q.clientId, quoteId: q.id, text: text || "(fichier joint)" });
    db.set("quotes", quotes);
    ctx.notifyAdmin(`[${q.number}] Nouveau message client`, text || "(fichier joint)", `/devis/${q.id}`, req);
    res.json(publicView(q, req));
  }));

  // Le client coche une option ou choisit une variante : le total est recalculé
  router.post("/public/quote/:token/choices", wrap((req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (!["brouillon", "envoye"].includes(q.status)) return res.status(400).json({ error: "Ce devis est déjà validé : contactez-nous pour le modifier." });
    const ids = new Set((q.lines || []).map(l => l.id));
    const opts = Object.fromEntries(Object.entries(req.body?.options || {}).filter(([id]) => ids.has(id) && q.lines.find(l => l.id === id)?.mode === "option").map(([id, v]) => [id, !!v]));
    const vars = Object.fromEntries(Object.entries(req.body?.variants || {}).filter(([g, id]) => q.lines.some(l => l.id === id && l.mode === "variant" && (l.group || "") === g)));
    q.choices = { options: { ...(q.choices?.options || {}), ...opts }, variants: { ...(q.choices?.variants || {}), ...vars } };
    recompute(q);
    q.updatedAt = Date.now(); q.attention = true;
    log(q, "choice", `Le client a ajusté ses options — nouveau total ${fmtEUR(q.computed.totals.ht)} HT`);
    db.set("quotes", quotes);
    res.json(publicView(q, req));
  }));

  router.post("/public/quote/:token/review", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (q.status !== "livre") return res.status(400).json({ error: "Vous pourrez donner votre avis après la livraison." });
    if (q.review) return res.status(400).json({ error: "Merci, votre avis est déjà enregistré." });
    const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 0));
    q.review = { rating, comment: clean(req.body.comment, 3000), at: Date.now() };
    q.attention = true;
    log(q, "review", `Avis client : ${"★".repeat(rating)}${"☆".repeat(5 - rating)}${q.review.comment ? ` « ${q.review.comment} »` : ""}`);
    ctx.addActivity({ type: "review", clientId: q.clientId, quoteId: q.id, text: `Avis ${rating}/5${q.review.comment ? ` : « ${q.review.comment} »` : ""}` });
    if (rating <= 3) ctx.addTask({ key: `quote:${q.id}:badreview`, title: `Avis ${rating}/5 sur ${q.number} : rappeler le client`, quoteId: q.id, clientId: q.clientId, auto: true, priority: "high" });
    db.set("quotes", quotes);
    res.json(publicView(q, req));
  }));

  router.post("/public/quote/:token/upload", wrap((req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    res.json({ ...saveDataUrl(uploadsDir, req.body?.dataUrl, { maxMb: 15 }), name: clean(req.body?.name, 200) });
  }));

  // Paiement de l'acompte en ligne (Stripe Checkout)
  router.post("/public/quote/:token/deposit", wrap(async (req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const settings = db.get("settings");
    if (!settings.onlinePayment || !process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error: "Paiement en ligne indisponible." });
    if (q.depositPayment?.paid) return res.status(400).json({ error: "Acompte déjà réglé." });
    const amount = Math.round((q.computed?.totals?.deposit || 0) * 100);
    if (amount < 50) return res.status(400).json({ error: "Aucun acompte à régler." });
    const back = ctx.clientLink(q, req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment", customer_email: q.client?.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: amount, product_data: { name: `Acompte — devis ${q.number}` } } }],
      success_url: `${back}&paid={CHECKOUT_SESSION_ID}`, cancel_url: back, metadata: { quoteId: q.id },
    });
    res.json({ url: session.url });
  }));

  router.post("/public/quote/:token/deposit/confirm", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const session = await stripe.checkout.sessions.retrieve(clean(req.body.sessionId, 300));
    if (session.metadata?.quoteId !== q.id || session.payment_status !== "paid") return res.status(400).json({ error: "Paiement non confirmé." });
    if (!q.depositPayment?.paid) {
      q.depositPayment = { paid: true, at: Date.now(), amount: r2(session.amount_total / 100), sessionId: session.id };
      if (!q.payment || q.payment.status === "non_paye") q.payment = { status: "acompte", at: Date.now(), note: "Stripe" };
      q.attention = true; q.updatedAt = Date.now();
      log(q, "payment", `Acompte de ${fmtEUR(q.depositPayment.amount)} payé en ligne`);
      ctx.completeTasks(`quote:${q.id}:deposit`);
      db.set("quotes", quotes);
      ctx.notifyAdmin(`[${q.number}] Acompte payé 💳`, `Acompte de ${fmtEUR(q.depositPayment.amount)} reçu.`, `/devis/${q.id}`, req);
    }
    res.json(publicView(q, req));
  }));

  /* ================= Modules ================= */
  crmRoutes(router, ctx);
  workflowRoutes(router, ctx);
  pennylaneRoutes(router, ctx);
  prospectionRoutes(router, ctx);
  qontoRoutes(router, ctx);
  purchasingRoutes(router, ctx);
  shopRoutes(router, ctx);
  atelierRoutes(router, ctx);
  startScheduler(ctx);

  return router;
}
