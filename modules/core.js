/* Contexte partagé entre les modules : base de données, emails, journal CRM, tâches. */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fmtEUR } from "../public/devis/pricing.js";

export const uid = (p = "") => p + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
export const token = () => crypto.randomBytes(18).toString("base64url");
export const clean = (s, max = 2000) => String(s ?? "").slice(0, max);
export const normEmail = e => String(e || "").trim().toLowerCase();
export const DAY = 864e5;

/* ---------- Fichiers (base64 → /uploads), signature binaire vérifiée ---------- */
const MIME = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif" };
export function saveDataUrl(uploadsDir, dataUrl, { allowPdf = true, maxMb = 15 } = {}) {
  const m = /^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Format invalide (PNG, JPG, WEBP, GIF" + (allowPdf ? " ou PDF" : "") + " attendu).");
  const isPdf = m[1] === "application/pdf";
  if (isPdf && !allowPdf) throw new Error("PDF non autorisé ici.");
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > maxMb * 1024 * 1024) throw new Error(`Fichier trop lourd (max ${maxMb} Mo).`);
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
export const cleanFiles = (files, max = 10) => (Array.isArray(files) ? files : [])
  .filter(f => typeof f?.url === "string" && /^\/uploads\/[\w.-]+$/.test(f.url)).slice(0, max)
  .map(f => ({ url: f.url, name: clean(f.name, 200), type: f.type === "pdf" ? "pdf" : "image" }));

export function createCore({ db, mail, adminPassword }) {
  const ctx = { db, mail, origin: "" };

  ctx.requireAdmin = (req, res, next) =>
    req.get("x-admin-password") === adminPassword ? next() : res.status(401).json({ error: "Non autorisé" });
  /** Mémorise l'URL publique vue lors des requêtes (utile aux tâches planifiées). */
  ctx.trackOrigin = (req, _res, next) => { if (!ctx.origin && req.get("host")) ctx.origin = `${req.protocol}://${req.get("host")}`; next(); };
  ctx.baseUrl = req => process.env.PUBLIC_URL?.replace(/\/$/, "") || (req ? `${req.protocol}://${req.get("host")}` : ctx.origin) || "http://localhost:4242";
  ctx.clientLink = (q, req) => `${ctx.baseUrl(req)}/devis/client.html?t=${q.token}`;
  ctx.adminLink = (hash, req) => `${ctx.baseUrl(req)}/devis/#${hash}`;
  ctx.wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error(e); res.status(e.status || 400).json({ error: e.message }); }
  };

  /* ---------- Journal d'activité CRM ---------- */
  ctx.addActivity = a => {
    const act = { id: uid("ac"), at: Date.now(), ...a };
    db.update("activities", list => { list.push(act); if (list.length > 20000) list.splice(0, list.length - 20000); });
    if (a.clientId && ["email_in", "email_out", "call", "meeting"].includes(a.type)) {
      db.update("clients", cs => { const c = cs.find(x => x.id === a.clientId); if (c) c.lastContactAt = act.at; });
    }
    return act;
  };
  ctx.logQuote = (q, type, text, extra = {}) => (q.history ||= []).push({ id: uid("h"), at: Date.now(), type, text, ...extra });

  /* ---------- Tâches (avec clé anti-doublon pour les tâches automatiques) ---------- */
  ctx.addTask = t => {
    return db.update("tasks", list => {
      if (t.key && list.some(x => x.key === t.key)) return null;
      const task = { id: uid("t"), createdAt: Date.now(), done: false, due: Date.now(), priority: "normal", ...t, title: clean(t.title, 300) };
      list.push(task);
      return task;
    });
  };
  ctx.completeTasks = key => db.update("tasks", list => list.forEach(t => { if (!t.done && t.key?.startsWith(key)) { t.done = true; t.doneAt = Date.now(); } }));

  /* ---------- Contacts ---------- */
  ctx.findClientByEmail = email => {
    const e = normEmail(email);
    return e ? db.get("clients").find(c => normEmail(c.email) === e) : null;
  };
  /** Trouve le contact par email ou le crée ; complète les champs vides. */
  ctx.ensureClient = (snap, { type = "client", source = "", tags = [] } = {}) => {
    if (!snap?.email && !snap?.company && !snap?.contact) return null;
    return db.update("clients", list => {
      const e = normEmail(snap.email);
      let c = e ? list.find(x => normEmail(x.email) === e) : null;
      if (!c && snap.company) c = list.find(x => x.company && x.company.trim().toLowerCase() === snap.company.trim().toLowerCase() && !x.email);
      if (c) {
        for (const k of ["company", "contact", "phone", "address", "zip", "city", "vatNumber"]) if (!c[k] && snap[k]) c[k] = clean(snap[k], 300);
        if (!c.email && e) c.email = e;
        if (type === "client" && c.type !== "client") c.type = "client";
        return c;
      }
      c = { id: uid("c"), createdAt: Date.now(), type, source, tags, discountPct: 0, notes: "",
        ...Object.fromEntries(["company", "contact", "phone", "address", "zip", "city", "vatNumber"].map(k => [k, clean(snap[k], 300)])), email: e };
      list.push(c);
      return c;
    });
  };

  /* ---------- Emails à partir des modèles ---------- */
  ctx.quoteVars = (q, req, extra = {}) => {
    const s = db.get("settings");
    const T = q.computed?.totals || {};
    return {
      contact: q.client?.contact || "", client: q.client?.company || q.client?.contact || "", numero: q.number, objet: q.title || "votre projet",
      lien: ctx.clientLink(q, req), montant_ht: fmtEUR(T.ht), montant_ttc: fmtEUR(T.ttc), acompte: fmtEUR(T.deposit),
      atelier: s.company.name, signature: s.emailSignature || s.company.name, date_limite: q.validUntil ? new Date(q.validUntil).toLocaleDateString("fr-FR") : "",
      transporteur: q.production?.carrier || "", suivi: q.production?.tracking || "", lien_suivi: q.production?.trackingUrl || "",
      version: (q.bats || []).length, ...extra,
    };
  };
  /** Envoie le modèle `key` au client du devis et trace l'envoi. Renvoie true si parti. */
  ctx.sendQuoteTemplate = async (q, key, req, extra = {}) => {
    const s = db.get("settings");
    const tpl = s.templates[key];
    const to = q.client?.email;
    if (!tpl || !to || !mail.configured()) return false;
    const vars = ctx.quoteVars(q, req, extra);
    const ok = await mail.trySend({ to, subject: mail.render(tpl.subject, vars), text: mail.render(tpl.body, vars) });
    if (ok) ctx.addActivity({ type: "email_out", clientId: q.clientId || null, quoteId: q.id, text: `Email « ${tpl.label} » envoyé à ${to}`, subject: mail.render(tpl.subject, vars) });
    return ok;
  };
  ctx.notifyAdmin = async (subject, text, hash, req) => {
    const s = db.get("settings");
    const to = s.notifyEmail || s.company.email;
    if (to) await mail.trySend({ to, subject, text: `${text}\n\n${ctx.adminLink(hash, req)}` });
  };

  return ctx;
}
