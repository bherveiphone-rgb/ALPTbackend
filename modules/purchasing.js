/* Achats et modèles : modèles de devis, mise à jour des tarifs fournisseurs,
   commande fournisseur regroupée (quantités par référence, couleur et taille). */
import { uid, clean, normEmail } from "./core.js";
import { r2 } from "../public/devis/pricing.js";

const OPEN = ["brouillon", "envoye"];

export function purchasingRoutes(router, ctx) {
  const { db, requireAdmin, wrap, mail } = ctx;

  /* ================= MODÈLES DE DEVIS ================= */
  router.get("/quote-templates", requireAdmin, (_req, res) => res.json(db.get("quoteTemplates")));
  router.post("/quote-templates", requireAdmin, wrap((req, res) => {
    const q = db.get("quotes").find(x => x.id === req.body?.fromQuoteId);
    if (!q) throw new Error("Devis introuvable");
    const name = clean(req.body?.name, 120).trim() || q.title || q.number;
    const t = {
      id: uid("tp"), name, createdAt: Date.now(), from: q.number, total: q.computed?.totals?.ht || 0,
      title: q.title, lines: structuredClone(q.lines || []).map(l => ({ ...l, sizes: req.body?.keepQty ? l.sizes : {} })),
      fees: structuredClone(q.fees || []), notes: q.notes, discountPct: q.discountPct || 0, shipping: q.shipping || 0,
    };
    db.update("quoteTemplates", l => l.push(t));
    res.json(t);
  }));
  router.delete("/quote-templates/:id", requireAdmin, (req, res) => {
    db.set("quoteTemplates", db.get("quoteTemplates").filter(t => t.id !== req.params.id));
    res.json({ ok: true });
  });

  /* ================= TARIFS FOURNISSEURS ================= */
  // Corps : { items: [{ ref, cost }], refreshDrafts: bool }
  router.post("/catalog/prices", requireAdmin, wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20000) : [];
    const byRef = new Map(items.map(i => [String(i.ref || "").trim().toLowerCase(), Number(i.cost)]).filter(([r, c]) => r && c > 0));
    const changes = [];
    db.update("catalog", list => {
      for (const a of list) {
        const c = byRef.get(String(a.ref || "").trim().toLowerCase());
        if (c && Math.abs(c - a.cost) > 0.0001) { changes.push({ id: a.id, ref: a.ref, name: a.name, old: a.cost, new: r2(c), pct: a.cost ? r2((c - a.cost) / a.cost * 100) : null }); a.cost = r2(c); }
      }
    });
    const changed = new Set(changes.map(c => c.id));
    const affected = db.get("quotes").filter(q => OPEN.includes(q.status) && (q.lines || []).some(l => changed.has(l.articleId)))
      .map(q => ({ id: q.id, number: q.number, status: q.status, client: q.client?.company || q.client?.contact || "" }));
    let refreshed = 0;
    if (req.body?.refreshDrafts) {
      const catalog = db.get("catalog");
      db.update("quotes", qs => {
        for (const q of qs.filter(x => x.status === "brouillon" && x.lines?.some(l => changed.has(l.articleId)))) {
          for (const l of q.lines) { const a = catalog.find(x => x.id === l.articleId); if (a && changed.has(a.id)) l.cost = a.cost; }
          ctx.logQuote(q, "pricing", "Prix d'achat mis à jour (tarif fournisseur)");
          ctx.recompute(q); refreshed++;
        }
      });
    }
    res.json({ updated: changes.length, unknown: [...byRef.keys()].filter(r => !db.get("catalog").some(a => String(a.ref || "").toLowerCase() === r)).length, changes, affected, refreshed });
  }));

  /* ================= COMMANDE FOURNISSEUR ================= */
  const supplierOf = l => (l.brand || "").trim() || "Sans fournisseur";
  router.get("/purchasing", requireAdmin, (_req, res) => {
    const quotes = db.get("quotes").filter(q => q.production && ["a_lancer", "commande"].includes(q.production.stage) && !q.production.purchasedAt);
    const stock = db.get("stock");
    const suppliers = {};
    for (const q of quotes) {
      for (const l of q.lines || []) {
        if (l.supplied || l.kind === "print" || l.ordered) continue;
        const sup = supplierOf(l);
        const s = (suppliers[sup] ||= { name: sup, rows: {}, quotes: new Set() });
        s.quotes.add(q.id);
        for (const [size, n] of Object.entries(l.sizes || {})) {
          const qty = parseInt(n, 10) || 0;
          if (!qty) continue;
          const key = `${l.ref}|${l.color}|${size}`;
          const r = (s.rows[key] ||= { ref: l.ref || "", name: l.name, color: l.color || "", size, qty: 0, numbers: new Set() });
          r.qty += qty; r.numbers.add(q.number);
        }
      }
    }
    const settings = db.get("settings");
    const out = Object.values(suppliers).map(s => ({
      name: s.name, email: (settings.suppliers || []).find(x => x.name.toLowerCase() === s.name.toLowerCase())?.email || "",
      quoteIds: [...s.quotes],
      rows: Object.values(s.rows).map(r => {
        const inStock = stock.filter(x => x.kind !== "consommable" && x.ref && x.ref.toLowerCase() === r.ref.toLowerCase() && (x.color || "").toLowerCase() === r.color.toLowerCase() && String(x.size || "").toLowerCase() === String(r.size).toLowerCase())
          .reduce((a, x) => a + (x.qty || 0), 0);
        return { ...r, numbers: [...r.numbers], inStock, toOrder: Math.max(0, r.qty - inStock) };
      }).sort((a, b) => (a.ref + a.color).localeCompare(b.ref + b.color) || 0),
    }));
    res.json({ suppliers: out, quotes: quotes.map(q => ({ id: q.id, number: q.number, client: q.client?.company || q.client?.contact || "", deadline: q.deadline || null })) });
  });

  // Marque les lignes d'un fournisseur comme commandées ; le devis passe en « Textile commandé » quand tout est commandé
  router.post("/purchasing/order", requireAdmin, wrap((req, res) => {
    const sup = clean(req.body?.supplier, 120);
    const ids = new Set(req.body?.quoteIds || []);
    let n = 0;
    db.update("quotes", qs => {
      for (const q of qs.filter(x => ids.has(x.id))) {
        for (const l of q.lines || []) if (!l.supplied && l.kind !== "print" && supplierOf(l) === sup) { l.ordered = true; l.orderedAt = Date.now(); }
        const pending = (q.lines || []).filter(l => !l.supplied && l.kind !== "print" && !l.ordered);
        ctx.logQuote(q, "purchase", `Textile/objets commandés chez ${sup}`);
        if (!pending.length && q.production) {
          q.production.purchasedAt = Date.now();
          if (q.production.stage === "a_lancer") { q.production.stage = "commande"; q.production.since = Date.now(); q.production.startedAt ||= Date.now(); }
          if (["accepte"].includes(q.status)) q.status = "production";
        }
        n++;
      }
    });
    ctx.completeTasks("purchase:");
    res.json({ count: n });
  }));

  router.post("/purchasing/email", requireAdmin, wrap(async (req, res) => {
    const to = normEmail(req.body?.to);
    if (!to) throw new Error("Email du fournisseur manquant");
    await mail.send({ to, subject: clean(req.body.subject, 300), text: clean(req.body.text, 50000) });
    ctx.addActivity({ type: "email_out", text: `Commande envoyée à ${req.body.supplier || to}` });
    res.json({ ok: true });
  }));

  router.put("/suppliers", requireAdmin, wrap((req, res) => {
    const list = (Array.isArray(req.body) ? req.body : []).map(s => ({ name: clean(s.name, 120), email: normEmail(s.email), notes: clean(s.notes, 500) })).filter(s => s.name);
    db.update("settings", s => { s.suppliers = list; });
    res.json(list);
  }));
}
