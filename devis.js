/* ============================================================
   MODULE DEVIS & BAT
   - API admin   : /api/devis/...            (en-tête x-admin-password)
   - API client  : /api/devis/public/:token  (lien secret envoyé au client)
   Persistance en fichiers JSON dans /data, fichiers dans /uploads.
   ============================================================ */
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { computeQuote, batStatusOf, QUOTE_STATUSES, fmtEUR, r2 } from "./public/devis/pricing.js";

const uid = (p = "") => p + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const token = () => crypto.randomBytes(18).toString("base64url");
const clean = (s, max = 2000) => String(s ?? "").slice(0, max);

/* ---------------- Données de départ ---------------- */
const SIZES_ADULT = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const SEED_SETTINGS = {
  company: {
    name: "Mon atelier de personnalisation", address: "", zip: "", city: "", country: "France",
    email: "", phone: "", website: "", siret: "", vatNumber: "", iban: "", bic: "", logo: "",
  },
  vatRate: 20, defaultCoef: 1.8, validityDays: 30, depositPct: 30, leadTime: "10 à 15 jours ouvrés après validation du BAT",
  quotePrefix: "DEV", nextNumber: 1,
  textileDiscounts: [{ min: 50, pct: 3 }, { min: 100, pct: 5 }, { min: 250, pct: 8 }, { min: 500, pct: 12 }],
  positions: ["Cœur", "Poitrine centre", "Dos", "Haut du dos", "Nuque", "Manche gauche", "Manche droite", "Bas de face", "Cuisse", "Face avant (casquette)", "Côté"],
  extraFees: [
    { id: "f1", label: "Vectorisation / retouche du logo", unit: 25, perPiece: false },
    { id: "f2", label: "Échantillon physique avant production", unit: 30, perPiece: false },
    { id: "f3", label: "Ensachage individuel", unit: 0.3, perPiece: true },
    { id: "f4", label: "Livraison express", unit: 35, perPiece: false },
  ],
  batChecklist: [
    "L'orthographe et les textes sont corrects",
    "Les couleurs (et références Pantone) sont conformes",
    "Les dimensions et emplacements des marquages sont validés",
    "Les quantités, couleurs de textile et tailles sont correctes",
  ],
  conditions: "Devis valable 30 jours. Production lancée après validation du BAT et réception de l'acompte. " +
    "Tolérance de ±3 % sur les quantités et de ±5 mm sur les positionnements. Les couleurs à l'écran peuvent légèrement différer du rendu final.",
  onlinePayment: false, notifyEmail: "", emailSignature: "",
};

const fmt = (id, label, w, h) => ({ id, label, w, h });
const SEED_TECHNIQUES = [
  {
    id: "serigraphie", name: "Sérigraphie", color: "#2563eb", colorsEnabled: true, maxColors: 8, minQty: 25,
    setupFee: 0, setupPerColor: 25, setupLabel: "Écrans", costPct: 35,
    description: "Idéal pour les séries, couleurs franches, excellente tenue.",
    formats: [fmt("coeur", "Cœur (≤ 10×10 cm)", 10, 10), fmt("a5", "A5 (≤ 15×21 cm)", 15, 21), fmt("a4", "A4 (≤ 21×30 cm)", 21, 30), fmt("a3", "A3 (≤ 30×42 cm)", 30, 42)],
    breaks: [25, 50, 100, 250, 500, 1000],
    prices: {
      coeur: [2.9, 2.2, 1.6, 1.2, 0.95, 0.8], a5: [3.4, 2.6, 1.9, 1.4, 1.1, 0.9],
      a4: [3.9, 2.9, 2.2, 1.6, 1.3, 1.05], a3: [4.9, 3.6, 2.7, 1.95, 1.55, 1.25],
    },
    extraColorPrices: [1.2, 0.9, 0.65, 0.45, 0.35, 0.28],
  },
  {
    id: "broderie", name: "Broderie", color: "#db2777", colorsEnabled: false, maxColors: 12, minQty: 1,
    setupFee: 45, setupPerColor: 0, setupLabel: "Digitalisation", costPct: 40,
    description: "Rendu premium et durable, idéal polos, casquettes, softshells. Prix selon nombre de points.",
    formats: [fmt("p", "Petit ≤ 8×8 cm (~5 000 pts)", 8, 8), fmt("m", "Moyen ≤ 12×12 cm (~10 000 pts)", 12, 12), fmt("g", "Grand ≤ 25×25 cm (~25 000 pts)", 25, 25)],
    breaks: [1, 10, 25, 50, 100, 250, 500],
    prices: { p: [6.5, 4.9, 3.9, 3.2, 2.7, 2.3, 2.0], m: [8.9, 6.9, 5.5, 4.6, 3.9, 3.3, 2.9], g: [18, 14, 11.5, 9.5, 8, 7, 6.2] },
    extraColorPrices: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "dtf", name: "Transfert DTF", color: "#ea580c", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45,
    description: "Quadrichromie sans frais fixes, parfait pour les petites séries et les visuels détaillés.",
    formats: [fmt("a7", "A7 (≤ 7,4×10,5 cm)", 7.4, 10.5), fmt("a6", "A6 (≤ 10,5×14,8 cm)", 10.5, 14.8), fmt("a5", "A5 (≤ 14,8×21 cm)", 14.8, 21), fmt("a4", "A4 (≤ 21×29,7 cm)", 21, 29.7), fmt("a3", "A3 (≤ 29,7×42 cm)", 29.7, 42)],
    breaks: [1, 10, 25, 50, 100, 250],
    prices: {
      a7: [4.5, 3.2, 2.5, 2.0, 1.6, 1.3], a6: [5.5, 3.9, 3.0, 2.5, 2.0, 1.7], a5: [7, 5, 3.9, 3.2, 2.6, 2.2],
      a4: [9.5, 6.9, 5.4, 4.5, 3.7, 3.1], a3: [13.5, 9.9, 7.8, 6.5, 5.4, 4.6],
    },
    extraColorPrices: [0, 0, 0, 0, 0, 0],
  },
  {
    id: "flocage", name: "Flocage / Flex", color: "#16a34a", colorsEnabled: true, maxColors: 3, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 40,
    description: "Noms, numéros et logos simples en flex ou floqué, idéal tenues sportives.",
    formats: [fmt("num_s", "Petit numéro / initiales (≤ 10×10 cm)", 10, 10), fmt("nom", "Nom (≤ 30×8 cm)", 30, 8), fmt("num_l", "Numéro dos (≤ 20×25 cm)", 20, 25), fmt("logo", "Logo A4 (≤ 21×30 cm)", 21, 30)],
    breaks: [1, 10, 25, 50, 100],
    prices: { num_s: [3.5, 3, 2.6, 2.3, 2], nom: [5, 4.2, 3.6, 3.2, 2.8], num_l: [6, 5, 4.4, 3.9, 3.4], logo: [8.5, 7, 6, 5.2, 4.5] },
    extraColorPrices: [2.5, 2, 1.7, 1.5, 1.3],
  },
];

const art = (id, ref, name, brand, category, cost, colors, sizes, sizeSurcharges = {}, coef = null) =>
  ({ id, ref, name, brand, category, cost, coef, salePrice: null, colors, sizes, sizeSurcharges, image: "", notes: "" });
const SEED_CATALOG = [
  art("a1", "STTU755", "Creator 2.0 — T-shirt unisexe bio", "Stanley/Stella", "T-shirt", 4.2, ["Blanc", "Noir", "French Navy", "Heather Grey", "Red", "Bright Blue"], ["XXS", ...SIZES_ADULT], { "2XL": 0.6, "3XL": 1.2 }),
  art("a2", "K356", "T-shirt col rond homme", "Kariban", "T-shirt", 2.35, ["Blanc", "Noir", "Navy", "Gris chiné", "Rouge", "Royal"], SIZES_ADULT, { "2XL": 0.4, "3XL": 0.8 }),
  art("a3", "TU01T", "#E190 T-shirt", "B&C", "T-shirt", 2.1, ["Blanc", "Noir", "Navy", "Sport Grey", "Red"], SIZES_ADULT, { "2XL": 0.35, "3XL": 0.7 }),
  art("a4", "K241", "Polo manches courtes homme", "Kariban", "Polo", 6.9, ["Blanc", "Noir", "Navy", "Royal"], SIZES_ADULT, { "2XL": 0.8, "3XL": 1.5 }),
  art("a5", "STSU823", "Cruiser 2.0 — Sweat capuche bio", "Stanley/Stella", "Sweat", 18.5, ["Noir", "French Navy", "Heather Grey", "Off White"], ["XS", "S", "M", "L", "XL", "2XL"], { "2XL": 1.5 }, 1.6),
  art("a6", "K474", "Sweat-shirt à capuche", "Kariban", "Sweat", 11.9, ["Noir", "Navy", "Gris chiné", "Bordeaux"], SIZES_ADULT, { "2XL": 1, "3XL": 2 }, 1.7),
  art("a7", "K401", "Veste softshell homme", "Kariban", "Veste", 21.9, ["Noir", "Navy", "Gris"], SIZES_ADULT, { "2XL": 1.5, "3XL": 3 }, 1.6),
  art("a8", "B15", "Casquette 5 panneaux", "Beechfield", "Accessoire", 2.6, ["Noir", "Navy", "Blanc", "Rouge"], ["Unique"]),
  art("a9", "W101", "Tote bag coton", "Westford Mill", "Bagagerie", 1.45, ["Naturel", "Noir", "Navy"], ["Unique"], {}, 2),
];

/* ---------------- Store JSON ---------------- */
function makeStore(dataDir) {
  const file = n => path.join(dataDir, `devis-${n}.json`);
  const seeds = { settings: SEED_SETTINGS, techniques: SEED_TECHNIQUES, catalog: SEED_CATALOG, clients: [], quotes: [] };
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  for (const [n, v] of Object.entries(seeds)) if (!fs.existsSync(file(n))) fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
  return {
    get: n => {
      const v = JSON.parse(fs.readFileSync(file(n), "utf8"));
      return n === "settings" ? { ...SEED_SETTINGS, ...v, company: { ...SEED_SETTINGS.company, ...(v.company || {}) } } : v;
    },
    set: (n, v) => {
      const tmp = file(n) + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
      fs.renameSync(tmp, file(n)); // écriture atomique
    },
  };
}

/* ---------------- Email (optionnel, via SMTP) ---------------- */
let transporter;
async function getMailer() {
  if (transporter !== undefined) return transporter;
  transporter = null;
  if (!process.env.SMTP_HOST) return null;
  try {
    const nodemailer = (await import("nodemailer")).default;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } catch (e) {
    console.warn("⚠️  nodemailer indisponible — envoi d'email désactivé :", e.message);
  }
  return transporter;
}
async function sendMail({ to, subject, text, replyTo }) {
  const t = await getMailer();
  if (!t || !to) return false;
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, replyTo });
    return true;
  } catch (e) {
    console.error("Erreur email :", e.message);
    return false;
  }
}

/* ---------------- Fichiers (base64 → /uploads) ---------------- */
const MIME = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif", "svg+xml": "svg" };
function saveDataUrl(uploadsDir, dataUrl, { allowPdf = true, maxMb = 15 } = {}) {
  const m = /^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Format invalide (PNG, JPG, WEBP, GIF" + (allowPdf ? " ou PDF" : "") + " attendu).");
  const isPdf = m[1] === "application/pdf";
  if (isPdf && !allowPdf) throw new Error("PDF non autorisé ici.");
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > maxMb * 1024 * 1024) throw new Error(`Fichier trop lourd (max ${maxMb} Mo).`);
  // Vérifie la signature binaire : on ne fait pas confiance au type déclaré.
  const sig = buf.subarray(0, 12);
  const ok = isPdf ? sig.toString("latin1", 0, 5) === "%PDF-"
    : (sig[0] === 0x89 && sig[1] === 0x50) || (sig[0] === 0xff && sig[1] === 0xd8) ||
      sig.toString("latin1", 0, 3) === "GIF" || sig.toString("latin1", 8, 12) === "WEBP";
  if (!ok) throw new Error("Le contenu du fichier ne correspond pas à son type.");
  const ext = isPdf ? "pdf" : MIME[m[2]] || "png";
  const name = "d" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return { url: "/uploads/" + name, type: isPdf ? "pdf" : "image" };
}

/* ============================================================ */
export function createDevisRouter({ dataDir, uploadsDir, adminPassword, stripe }) {
  const db = makeStore(dataDir);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const router = express.Router();
  router.use(express.json({ limit: "40mb" }));

  const requireAdmin = (req, res, next) =>
    req.get("x-admin-password") === adminPassword ? next() : res.status(401).json({ error: "Non autorisé" });
  const baseUrl = req => process.env.PUBLIC_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
  const clientLink = (req, q) => `${baseUrl(req)}/devis/client.html?t=${q.token}`;
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
  };

  /* -------- Calcul : les techniques figées dans le devis priment -------- */
  const techsFor = q => {
    const global = db.get("techniques");
    const snap = q.techSnapshot || {};
    const ids = new Set([...global.map(t => t.id), ...Object.keys(snap)]);
    return [...ids].map(id => snap[id] || global.find(t => t.id === id)).filter(Boolean);
  };
  function recompute(q, settings = db.get("settings")) {
    // fige les grilles des techniques utilisées → les prix d'un devis envoyé ne bougent plus
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
  const log = (q, type, text, extra = {}) => (q.history ||= []).push({ id: uid("h"), at: Date.now(), type, text, ...extra });

  function summary(q) {
    return {
      id: q.id, number: q.number, title: q.title, status: q.status, batStatus: batStatusOf(q),
      client: { company: q.client?.company || "", contact: q.client?.contact || "", email: q.client?.email || "" },
      clientId: q.clientId || null, createdAt: q.createdAt, updatedAt: q.updatedAt, sentAt: q.sentAt || null,
      acceptedAt: q.acceptance?.at || null, viewedAt: q.viewedAt || null, validUntil: q.validUntil,
      attention: !!q.attention, totals: q.computed?.totals || {}, depositPaid: !!q.depositPayment?.paid,
      batCount: (q.bats || []).length, lineCount: (q.lines || []).length,
    };
  }

  /* ================= ADMIN ================= */
  router.get("/bootstrap", requireAdmin, (_req, res) => {
    res.json({
      settings: db.get("settings"), techniques: db.get("techniques"), catalog: db.get("catalog"), clients: db.get("clients"),
      mailEnabled: !!process.env.SMTP_HOST, stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  router.put("/settings", requireAdmin, (req, res) => {
    const cur = db.get("settings");
    const next = { ...cur, ...req.body, company: { ...cur.company, ...(req.body.company || {}) } };
    db.set("settings", next);
    res.json(next);
  });

  // CRUD générique pour références, techniques et clients
  for (const coll of ["catalog", "techniques", "clients"]) {
    router.get(`/${coll}`, requireAdmin, (_req, res) => res.json(db.get(coll)));
    router.post(`/${coll}`, requireAdmin, (req, res) => {
      const list = db.get(coll);
      const item = { ...req.body, id: req.body.id && !list.some(x => x.id === req.body.id) ? req.body.id : uid(coll[0]) };
      if (coll === "clients") item.createdAt = Date.now();
      list.push(item);
      db.set(coll, list);
      res.json(item);
    });
    router.put(`/${coll}/:id`, requireAdmin, (req, res) => {
      const list = db.get(coll);
      const i = list.findIndex(x => x.id === req.params.id);
      if (i === -1) return res.status(404).json({ error: "Élément introuvable" });
      list[i] = { ...list[i], ...req.body, id: list[i].id };
      db.set(coll, list);
      res.json(list[i]);
    });
    router.delete(`/${coll}/:id`, requireAdmin, (req, res) => {
      db.set(coll, db.get(coll).filter(x => x.id !== req.params.id));
      res.json({ ok: true });
    });
    // Mise à jour en masse (import, ajustement de prix…)
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

  router.get("/quotes/:id", requireAdmin, (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    if (q.attention) { q.attention = false; db.set("quotes", quotes); }
    res.json({ ...q, link: clientLink(req, q), techniques: techsFor(q) });
  });

  const EDITABLE = ["title", "clientId", "client", "lines", "fees", "discountPct", "shipping", "vatRate", "depositPct",
    "validUntil", "leadTime", "notes", "internalNotes", "setupOverrides", "status"];
  const pick = body => Object.fromEntries(EDITABLE.filter(k => k in body).map(k => [k, body[k]]));

  router.post("/quotes", requireAdmin, (req, res) => {
    const settings = db.get("settings");
    const quotes = db.get("quotes");
    const year = new Date().getFullYear();
    const q = {
      id: uid("q"), token: token(), number: `${settings.quotePrefix || "DEV"}-${year}-${String(settings.nextNumber || 1).padStart(4, "0")}`,
      createdAt: Date.now(), updatedAt: Date.now(), status: "brouillon", title: "", client: {}, clientId: null,
      lines: [], fees: [], discountPct: 0, shipping: 0, vatRate: settings.vatRate, depositPct: settings.depositPct,
      validUntil: Date.now() + (settings.validityDays || 30) * 864e5, leadTime: settings.leadTime, notes: "", internalNotes: "",
      setupOverrides: {}, bats: [], history: [], messages: [], files: [], ...pick(req.body),
    };
    q.status = "brouillon";
    log(q, "create", "Devis créé");
    recompute(q, settings);
    quotes.push(q);
    db.set("quotes", quotes);
    db.set("settings", { ...settings, nextNumber: (settings.nextNumber || 1) + 1 });
    res.json({ ...q, link: clientLink(req, q), techniques: techsFor(q) });
  });

  router.put("/quotes/:id", requireAdmin, (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    const patch = pick(req.body);
    if (patch.status && patch.status !== q.status) {
      if (!QUOTE_STATUSES[patch.status]) return res.status(400).json({ error: "Statut invalide" });
      log(q, "status", `Statut changé : ${QUOTE_STATUSES[q.status]?.label} → ${QUOTE_STATUSES[patch.status].label}`);
    }
    Object.assign(q, patch, { updatedAt: Date.now() });
    recompute(q);
    db.set("quotes", quotes);
    res.json({ ...q, link: clientLink(req, q), techniques: techsFor(q) });
  });

  // Ré-applique les grilles actuelles des techniques (si vous avez changé vos tarifs)
  router.post("/quotes/:id/refresh-pricing", requireAdmin, (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
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
    res.json({ ...q, link: clientLink(req, q), techniques: techsFor(q) });
  });

  router.delete("/quotes/:id", requireAdmin, (req, res) => {
    db.set("quotes", db.get("quotes").filter(x => x.id !== req.params.id));
    res.json({ ok: true });
  });

  router.post("/quotes/:id/duplicate", requireAdmin, (req, res) => {
    const settings = db.get("settings");
    const quotes = db.get("quotes");
    const src = quotes.find(x => x.id === req.params.id);
    if (!src) return res.status(404).json({ error: "Devis introuvable" });
    const q = {
      ...structuredClone(src), id: uid("q"), token: token(),
      number: `${settings.quotePrefix || "DEV"}-${new Date().getFullYear()}-${String(settings.nextNumber || 1).padStart(4, "0")}`,
      createdAt: Date.now(), updatedAt: Date.now(), status: "brouillon", bats: [], history: [], messages: [], files: [],
      acceptance: null, decline: null, sentAt: null, viewedAt: null, attention: false, depositPayment: null, techSnapshot: {},
      validUntil: Date.now() + (settings.validityDays || 30) * 864e5, title: src.title ? `${src.title} (copie)` : "",
    };
    log(q, "create", `Devis dupliqué depuis ${src.number}`);
    recompute(q, settings);
    quotes.push(q);
    db.set("quotes", quotes);
    db.set("settings", { ...settings, nextNumber: (settings.nextNumber || 1) + 1 });
    res.json({ id: q.id });
  });

  // Envoi du devis au client (marque "envoyé" + email si SMTP configuré)
  router.post("/quotes/:id/send", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    const settings = db.get("settings");
    const link = clientLink(req, q);
    let mailed = false;
    if (req.body?.email && req.body?.to) {
      mailed = await sendMail({
        to: clean(req.body.to, 300), subject: clean(req.body.subject, 300) || `Votre devis ${q.number}`,
        text: `${clean(req.body.message, 5000)}\n\n${link}`, replyTo: settings.company.email || undefined,
      });
      if (!mailed) return res.status(400).json({ error: "L'email n'a pas pu être envoyé (vérifiez la configuration SMTP)." });
    }
    if (q.status === "brouillon") q.status = "envoye";
    q.sentAt = Date.now(); q.updatedAt = Date.now();
    log(q, "send", mailed ? `Devis envoyé par email à ${req.body.to}` : "Devis marqué comme envoyé (lien partagé)");
    db.set("quotes", quotes);
    res.json({ ok: true, link, mailed });
  }));

  // Nouvelle version de BAT
  router.post("/quotes/:id/bats", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    const files = (req.body.files || []).filter(f => typeof f?.url === "string" && f.url.startsWith("/uploads/"))
      .map(f => ({ url: f.url, name: clean(f.name, 200), type: f.type === "pdf" ? "pdf" : "image" }));
    if (!files.length) return res.status(400).json({ error: "Ajoutez au moins un fichier au BAT." });
    q.bats ||= [];
    // une nouvelle version remplace la précédente si elle était encore en attente
    for (const b of q.bats) if (b.status === "en_attente") b.status = "remplace";
    const bat = {
      id: uid("b"), version: q.bats.length + 1, files, message: clean(req.body.message, 5000),
      specs: clean(req.body.specs, 5000), createdAt: Date.now(), status: "en_attente", response: null,
    };
    q.bats.push(bat);
    q.updatedAt = Date.now();
    log(q, "bat", `BAT V${bat.version} envoyé au client (${files.length} fichier${files.length > 1 ? "s" : ""})`);
    let mailed = false;
    if (req.body.email && q.client?.email) {
      const settings = db.get("settings");
      mailed = await sendMail({
        to: q.client.email, replyTo: settings.company.email || undefined,
        subject: `BAT V${bat.version} à valider — devis ${q.number}`,
        text: `Bonjour ${q.client.contact || ""},\n\nVotre BAT (V${bat.version}) est disponible. Merci de le vérifier attentivement puis de le valider ou de demander une modification :\n${clientLink(req, q)}\n\n${bat.message}\n\n${settings.emailSignature || settings.company.name}`,
      });
    }
    db.set("quotes", quotes);
    res.json({ ok: true, bat, mailed });
  }));

  router.patch("/quotes/:id/bats/:batId", requireAdmin, (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    const b = q?.bats?.find(x => x.id === req.params.batId);
    if (!b) return res.status(404).json({ error: "BAT introuvable" });
    if (req.body.status && ["en_attente", "valide", "modif", "remplace"].includes(req.body.status) && req.body.status !== b.status) {
      b.status = req.body.status;
      log(q, "bat", `BAT V${b.version} : statut forcé manuellement à « ${b.status} »`);
    }
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(b);
  });

  router.delete("/quotes/:id/bats/:batId", requireAdmin, (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    q.bats = (q.bats || []).filter(b => b.id !== req.params.batId);
    log(q, "bat", "Une version de BAT a été supprimée");
    db.set("quotes", quotes);
    res.json({ ok: true });
  });

  // Messages (visibles par le client) et notes internes
  router.post("/quotes/:id/messages", requireAdmin, wrap(async (req, res) => {
    const quotes = db.get("quotes");
    const q = quotes.find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    const text = clean(req.body.text, 5000).trim();
    if (!text) return res.status(400).json({ error: "Message vide" });
    if (req.body.internal) log(q, "note", text);
    else {
      (q.messages ||= []).push({ id: uid("m"), at: Date.now(), from: "atelier", text, files: [] });
      if (req.body.email && q.client?.email) {
        await sendMail({ to: q.client.email, subject: `Nouveau message — devis ${q.number}`, text: `${text}\n\nRépondre : ${clientLink(req, q)}` });
      }
    }
    q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(q);
  }));

  router.get("/backup", requireAdmin, (_req, res) => {
    res.setHeader("Content-Disposition", `attachment; filename="sauvegarde-devis-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(Object.fromEntries(["settings", "techniques", "catalog", "clients", "quotes"].map(n => [n, db.get(n)])));
  });
  router.post("/restore", requireAdmin, (req, res) => {
    const b = req.body || {};
    for (const n of ["settings", "techniques", "catalog", "clients", "quotes"]) {
      if (n in b && (n === "settings" ? typeof b[n] === "object" : Array.isArray(b[n]))) db.set(n, b[n]);
    }
    res.json({ ok: true });
  });

  /* ================= CLIENT (lien secret) ================= */
  function findByToken(t) {
    const quotes = db.get("quotes");
    const q = typeof t === "string" && t.length > 10 ? quotes.find(x => x.token === t) : null;
    return { quotes, q };
  }
  // Ne renvoie JAMAIS les prix d'achat, coefficients ou marges au client.
  function publicView(q) {
    const settings = db.get("settings");
    const c = q.computed || recompute(q, settings).computed;
    const { cost, margin, marginPct, ...totals } = c.totals;
    return {
      number: q.number, title: q.title, status: q.status, createdAt: q.createdAt, validUntil: q.validUntil,
      leadTime: q.leadTime, notes: q.notes, client: q.client || {},
      company: settings.company, conditions: settings.conditions, batChecklist: settings.batChecklist,
      lines: c.lines.map(l => ({
        name: l.name, ref: l.ref, brand: l.brand, color: l.color, image: l.image, note: l.note, supplied: l.supplied,
        qty: l.qty, unit: l.unit, total: l.total, sizes: l.sizeRows.map(r => ({ size: r.size, qty: r.qty })),
        persos: l.persos.map(p => ({ technique: p.techniqueName, position: p.position, format: p.formatLabel, w: p.w, h: p.h, colors: p.colorsEnabled ? p.colors : null, design: p.design })),
      })),
      setups: c.setups.map(s => ({ label: s.label, amount: s.amount })),
      fees: c.fees, totals,
      acceptance: q.acceptance ? { name: q.acceptance.name, at: q.acceptance.at, signature: q.acceptance.signature } : null,
      decline: q.decline || null,
      bats: (q.bats || []).map(b => ({ id: b.id, version: b.version, files: b.files, message: b.message, specs: b.specs, createdAt: b.createdAt, status: b.status, response: b.response })),
      messages: q.messages || [], files: q.files || [],
      deposit: {
        enabled: !!(settings.onlinePayment && process.env.STRIPE_SECRET_KEY), amount: totals.deposit,
        paid: !!q.depositPayment?.paid, paidAt: q.depositPayment?.at || null,
      },
    };
  }
  const notifyAdmin = async (req, q, subject, text) => {
    const s = db.get("settings");
    const to = s.notifyEmail || s.company.email;
    if (to) await sendMail({ to, subject: `[${q.number}] ${subject}`, text: `${text}\n\nOuvrir le devis : ${baseUrl(req)}/devis/#/devis/${q.id}` });
  };

  router.get("/public/:token", (req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Ce lien n'est pas valide ou a expiré." });
    res.json(publicView(q));
  });

  router.post("/public/:token/view", (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (!q.viewedAt) log(q, "view", "Devis consulté pour la première fois par le client");
    q.viewedAt = Date.now();
    q.viewCount = (q.viewCount || 0) + 1;
    db.set("quotes", quotes);
    res.json({ ok: true });
  });

  const validSignature = s => typeof s === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 400_000;

  router.post("/public/:token/accept", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (["accepte", "production", "livre"].includes(q.status)) return res.status(400).json({ error: "Ce devis est déjà accepté." });
    if (["annule"].includes(q.status)) return res.status(400).json({ error: "Ce devis a été annulé." });
    if (q.validUntil && Date.now() > q.validUntil + 864e5) return res.status(400).json({ error: "Ce devis a expiré. Contactez-nous pour le réactualiser." });
    const name = clean(req.body.name, 120).trim();
    if (!name || !validSignature(req.body.signature)) return res.status(400).json({ error: "Nom et signature requis." });
    q.acceptance = { name, signature: req.body.signature, comment: clean(req.body.comment, 2000), at: Date.now(), ip: req.ip, ttc: q.computed?.totals?.ttc };
    q.status = "accepte"; q.attention = true; q.updatedAt = Date.now();
    log(q, "accept", `Devis accepté et signé par ${name} (« Bon pour accord »)`);
    db.set("quotes", quotes);
    notifyAdmin(req, q, "Devis accepté ✅", `${name} a accepté le devis ${q.number} (${fmtEUR(q.computed?.totals?.ttc)} TTC).`);
    res.json(publicView(q));
  }));

  router.post("/public/:token/decline", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    if (q.status !== "envoye" && q.status !== "brouillon") return res.status(400).json({ error: "Ce devis ne peut plus être refusé en ligne." });
    q.decline = { comment: clean(req.body.comment, 2000), at: Date.now() };
    q.status = "refuse"; q.attention = true; q.updatedAt = Date.now();
    log(q, "decline", `Devis refusé par le client${q.decline.comment ? ` : « ${q.decline.comment} »` : ""}`);
    db.set("quotes", quotes);
    notifyAdmin(req, q, "Devis refusé", q.decline.comment || "Sans commentaire");
    res.json(publicView(q));
  }));

  router.post("/public/:token/bats/:batId/:action(approve|reject)", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    const b = q?.bats?.find(x => x.id === req.params.batId);
    if (!b) return res.status(404).json({ error: "BAT introuvable" });
    if (b.status !== "en_attente") return res.status(400).json({ error: "Ce BAT a déjà reçu une réponse ou a été remplacé." });
    const comment = clean(req.body.comment, 5000).trim();
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
      notifyAdmin(req, q, `BAT V${b.version} validé ✅`, `${name} a validé le BAT.${comment ? `\nCommentaire : ${comment}` : ""}`);
    } else {
      if (!comment) return res.status(400).json({ error: "Merci de préciser les modifications souhaitées." });
      const files = (req.body.files || []).filter(f => f?.url?.startsWith("/uploads/")).map(f => ({ url: f.url, name: clean(f.name, 200), type: f.type === "pdf" ? "pdf" : "image" }));
      b.status = "modif";
      b.response = { comment, files, at: Date.now(), name: clean(req.body.name, 120) };
      log(q, "bat_ko", `Modification demandée sur le BAT V${b.version} : « ${comment} »`);
      notifyAdmin(req, q, `Modification demandée sur le BAT V${b.version}`, comment);
    }
    q.attention = true; q.updatedAt = Date.now();
    db.set("quotes", quotes);
    res.json(publicView(q));
  }));

  router.post("/public/:token/messages", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const text = clean(req.body.text, 5000).trim();
    const files = (req.body.files || []).filter(f => f?.url?.startsWith("/uploads/")).slice(0, 10)
      .map(f => ({ url: f.url, name: clean(f.name, 200), type: f.type === "pdf" ? "pdf" : "image" }));
    if (!text && !files.length) return res.status(400).json({ error: "Message vide" });
    if ((q.messages || []).filter(m => m.from === "client" && Date.now() - m.at < 60_000).length >= 5) {
      return res.status(429).json({ error: "Trop de messages, patientez une minute." });
    }
    (q.messages ||= []).push({ id: uid("m"), at: Date.now(), from: "client", text, files });
    if (files.length) (q.files ||= []).push(...files.map(f => ({ ...f, at: Date.now(), from: "client" })));
    q.attention = true; q.updatedAt = Date.now();
    log(q, "message", `Message du client${files.length ? ` (+${files.length} fichier${files.length > 1 ? "s" : ""})` : ""}`);
    db.set("quotes", quotes);
    notifyAdmin(req, q, "Nouveau message client", text || "(fichier joint)");
    res.json(publicView(q));
  }));

  router.post("/public/:token/upload", wrap((req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    res.json({ ...saveDataUrl(uploadsDir, req.body?.dataUrl, { maxMb: 15 }), name: clean(req.body?.name, 200) });
  }));

  // Paiement de l'acompte en ligne (Stripe Checkout)
  router.post("/public/:token/deposit", wrap(async (req, res) => {
    const { q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const settings = db.get("settings");
    if (!settings.onlinePayment || !process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error: "Paiement en ligne indisponible." });
    if (q.depositPayment?.paid) return res.status(400).json({ error: "Acompte déjà réglé." });
    const amount = Math.round((q.computed?.totals?.deposit || 0) * 100);
    if (amount < 50) return res.status(400).json({ error: "Aucun acompte à régler." });
    const back = `${baseUrl(req)}/devis/client.html?t=${q.token}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment", customer_email: q.client?.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: amount, product_data: { name: `Acompte — devis ${q.number}` } } }],
      success_url: `${back}&paid={CHECKOUT_SESSION_ID}`, cancel_url: back, metadata: { quoteId: q.id },
    });
    res.json({ url: session.url });
  }));

  router.post("/public/:token/deposit/confirm", wrap(async (req, res) => {
    const { quotes, q } = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: "Lien invalide" });
    const session = await stripe.checkout.sessions.retrieve(clean(req.body.sessionId, 300));
    if (session.metadata?.quoteId !== q.id || session.payment_status !== "paid") return res.status(400).json({ error: "Paiement non confirmé." });
    if (!q.depositPayment?.paid) {
      q.depositPayment = { paid: true, at: Date.now(), amount: r2(session.amount_total / 100), sessionId: session.id };
      q.attention = true; q.updatedAt = Date.now();
      log(q, "payment", `Acompte de ${fmtEUR(q.depositPayment.amount)} payé en ligne`);
      db.set("quotes", quotes);
      notifyAdmin(req, q, "Acompte payé 💳", `Acompte de ${fmtEUR(q.depositPayment.amount)} reçu.`);
    }
    res.json(publicView(q));
  }));

  return router;
}
