/* Statistiques (CA, marges, conversion) et sauvegarde automatique quotidienne
   vers data/backups et, si défini, un dossier synchronisé (OneDrive, Google Drive, NAS…). */
import fs from "fs";
import path from "path";
import { clean } from "./core.js";
import { r2 } from "../public/devis/pricing.js";

const SIGNED = ["accepte", "production", "expedie", "livre"];
const monthKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function insightsRoutes(router, ctx, { dataDir, uploadsDir }) {
  const { db, requireAdmin, wrap } = ctx;

  /* ================= STATISTIQUES ================= */
  router.get("/stats", requireAdmin, (req, res) => {
    const to = Number(req.query.to) || Date.now();
    const from = Number(req.query.from) || new Date(new Date(to).getFullYear(), 0, 1).getTime();
    const quotes = db.get("quotes"), requests = db.get("requests"), clients = db.get("clients"), techniques = db.get("techniques");
    const signedAt = q => q.acceptance?.at || q.acceptedAt || 0;
    const signed = quotes.filter(q => SIGNED.includes(q.status) && signedAt(q) >= from && signedAt(q) <= to);
    const sent = quotes.filter(q => q.sentAt && q.sentAt >= from && q.sentAt <= to);
    const tot = (list, k) => r2(list.reduce((s, q) => s + (q.computed?.totals?.[k] || 0), 0));
    const ca = tot(signed, "ht"), margin = tot(signed, "margin");

    // 12 derniers mois glissants jusqu'à « to »
    const months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(to); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(monthKey(d)); }
    const byMonth = Object.fromEntries(months.map(m => [m, { month: m, ht: 0, margin: 0, count: 0 }]));
    for (const q of quotes.filter(x => SIGNED.includes(x.status) && signedAt(x))) {
      const m = byMonth[monthKey(signedAt(q))];
      if (m) { m.ht = r2(m.ht + (q.computed?.totals?.ht || 0)); m.margin = r2(m.margin + (q.computed?.totals?.margin || 0)); m.count++; }
    }

    const techName = id => techniques.find(t => t.id === id)?.name || id;
    const byTech = {}, byUni = {}, byClient = {};
    const add = (o, k, label, ht, cost, qty = 0) => { const x = (o[k] ||= { key: k, label, ht: 0, cost: 0, qty: 0, count: 0 }); x.ht = r2(x.ht + ht); x.cost = r2(x.cost + cost); x.qty += qty; x.count++; };
    for (const q of signed) {
      const c = q.computed || {};
      for (const l of c.lines || []) {
        const uni = l.universe || "textile";
        add(byUni, uni, { textile: "Textile", objet: "Objets", print: "Print" }[uni] || uni, l.total || 0, l.cost || 0, l.qty || 0);
        for (const p of l.persos || []) add(byTech, p.techniqueId, techName(p.techniqueId), p.total || 0, p.cost || 0, l.qty || 0);
      }
      for (const s of c.setups || []) if (s.techniqueId) add(byTech, s.techniqueId, techName(s.techniqueId), s.amount || 0, s.cost || 0);
      const name = q.client?.company || q.client?.contact || q.client?.email || "Sans nom";
      add(byClient, q.clientId || name, name, c.totals?.ht || 0, c.totals?.cost || 0);
    }
    const withPct = o => Object.values(o).map(x => ({ ...x, margin: r2(x.ht - x.cost), marginPct: x.ht ? Math.round((x.ht - x.cost) / x.ht * 100) : 0 })).sort((a, b) => b.ht - a.ht);

    // Conversion par origine (demandes reçues sur la période → devis signé)
    const bySource = {};
    for (const r of requests.filter(x => x.createdAt >= from && x.createdAt <= to)) {
      const k = r.source || "autre";
      const s = (bySource[k] ||= { source: k, requests: 0, won: 0, ht: 0 });
      s.requests++;
      const won = quotes.filter(q => q.requestId === r.id && SIGNED.includes(q.status));
      if (won.length) { s.won++; s.ht = r2(s.ht + won.reduce((a, q) => a + (q.computed?.totals?.ht || 0), 0)); }
    }
    // Origine des contacts pour les devis signés
    const byClientSource = {};
    for (const q of signed) {
      const src = clients.find(c => c.id === q.clientId)?.source || "inconnue";
      const s = (byClientSource[src] ||= { source: src, count: 0, ht: 0 });
      s.count++; s.ht = r2(s.ht + (q.computed?.totals?.ht || 0));
    }
    const lost = {};
    for (const q of quotes.filter(x => x.status === "refuse" && (x.updatedAt || 0) >= from && (x.updatedAt || 0) <= to)) lost[q.lostReason || "Non précisé"] = (lost[q.lostReason || "Non précisé"] || 0) + 1;
    const delays = signed.filter(q => q.sentAt && signedAt(q) > q.sentAt).map(q => (signedAt(q) - q.sentAt) / 864e5);

    res.json({
      from, to,
      kpis: {
        ca, margin, marginPct: ca ? Math.round(margin / ca * 100) : 0, signed: signed.length, avgBasket: signed.length ? r2(ca / signed.length) : 0,
        sent: sent.length, conversion: sent.length ? Math.round(sent.filter(q => SIGNED.includes(q.status)).length / sent.length * 100) : 0,
        avgDaysToSign: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length * 10) / 10 : null,
        pieces: signed.reduce((s, q) => s + (q.computed?.totals?.qty || 0), 0),
        pipeline: tot(quotes.filter(q => q.status === "envoye"), "ht"),
      },
      months: Object.values(byMonth), techniques: withPct(byTech), universes: withPct(byUni), clients: withPct(byClient).slice(0, 15),
      sources: Object.values(bySource).sort((a, b) => b.requests - a.requests), clientSources: Object.values(byClientSource).sort((a, b) => b.ht - a.ht),
      lost: Object.entries(lost).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    });
  });

  /* ================= SAUVEGARDE AUTOMATIQUE ================= */
  const localDir = path.join(dataDir, "backups");
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const prune = (dir, keep) => {
    const files = fs.readdirSync(dir).filter(f => /^sauvegarde-.*\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  };
  // Copie incrémentale des fichiers clients (visuels, BAT) : seuls les nouveaux sont copiés
  const fsp = fs.promises;
  const copyUploads = async dest => {
    if (!fs.existsSync(uploadsDir)) return 0;
    await fsp.mkdir(dest, { recursive: true });
    const have = new Set(await fsp.readdir(dest));
    let n = 0;
    for (const f of fs.readdirSync(uploadsDir)) if (!have.has(f)) { await fsp.copyFile(path.join(uploadsDir, f), path.join(dest, f)); n++; }
    return n;
  };
  const prunePromise = async (dir, keep) => {
    const files = (await fsp.readdir(dir)).filter(f => /^sauvegarde-.*\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) await fsp.unlink(path.join(dir, f));
  };
  // Un dossier réseau ou cloud qui ne répond pas ne doit jamais bloquer l'outil
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error("le dossier ne répond pas (délai dépassé)")), ms).unref?.())]);

  let running = null;
  ctx.runBackup = (reason = "auto") => running ||= (async () => {
    const s = db.get("settings").backup || {};
    const keep = Math.max(1, Number(s.keep) || 30);
    const data = JSON.stringify(ctx.backupData(), null, 1);
    const name = `sauvegarde-${stamp()}.json`;
    const out = { at: Date.now(), reason, file: name, size: data.length, local: false, remote: null, files: 0 };
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, name), data);
    prune(localDir, keep);
    out.local = true;
    const dir = String(s.dir || "").trim();
    if (dir) {
      try {
        await withTimeout((async () => {
          await fsp.mkdir(dir, { recursive: true });
          await fsp.writeFile(path.join(dir, name), data);
          await prunePromise(dir, keep);
          out.files = await copyUploads(path.join(dir, "fichiers"));
        })(), 120_000);
        out.remote = { ok: true, dir };
      } catch (e) { out.remote = { ok: false, dir, error: e.message }; }
    }
    db.set("backupstate", { ...db.get("backupstate"), last: out, lastDay: new Date().toDateString() });
    if (out.remote && !out.remote.ok) ctx.addTask({ key: `backup:fail:${new Date().toDateString()}`, auto: true, priority: "high", title: `Sauvegarde vers ${dir} impossible : ${out.remote.error}` });
    return out;
  })().finally(() => { running = null; });
  /** Appelé par le planificateur : une sauvegarde par jour (la première minute où l'outil tourne). */
  ctx.backupTick = () => {
    if (db.get("settings").backup?.enabled === false) return;
    if (db.get("backupstate").lastDay !== new Date().toDateString()) ctx.runBackup("auto").catch(e => console.error("Sauvegarde :", e.message));
  };

  router.get("/backup-status", requireAdmin, (_req, res) => {
    let files = [];
    try { files = fs.readdirSync(localDir).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 10); } catch { /* aucun */ }
    res.json({ ...db.get("backupstate"), localDir, files });
  });
  router.post("/backup/run", requireAdmin, wrap(async (_req, res) => res.json(await ctx.runBackup("manuel"))));
  router.put("/backup/settings", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const dir = clean(b.dir, 500).trim();
    if (dir && !path.isAbsolute(dir)) throw new Error("Indiquez un chemin complet, ex. C:\\Users\\vous\\OneDrive\\Sauvegardes atelier");
    db.update("settings", s => { s.backup = { ...(s.backup || {}), dir, keep: Math.min(365, Math.max(1, parseInt(b.keep, 10) || 30)), enabled: b.enabled !== false }; });
    res.json(db.get("settings").backup);
  }));
}
