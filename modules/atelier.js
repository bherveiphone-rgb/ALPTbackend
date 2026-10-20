/* Atelier : planning de production par machine et par jour, gestion du stock
   (textile en avance, consommables) avec mouvements, déduction et alertes de seuil. */
import { uid, clean, DAY } from "./core.js";

const PLANNABLE = ["a_lancer", "commande", "marquage"];
const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const norm = s => String(s ?? "").trim().toLowerCase();

export function atelierRoutes(router, ctx) {
  const { db, requireAdmin, wrap } = ctx;

  /* ================= PLANNING ================= */
  /** Pièces par technique d'un devis (lignes retenues uniquement). */
  function jobOf(q) {
    const byTech = {};
    let qty = 0;
    for (const l of q.computed?.lines || []) {
      qty += l.qty || 0;
      for (const p of l.persos || []) byTech[p.techniqueId] = (byTech[p.techniqueId] || 0) + (l.qty || 0);
    }
    const main = Object.entries(byTech).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const machines = db.get("settings").machines || [];
    const suggested = machines.find(m => (m.techniques || []).includes(main))?.id || machines[0]?.id || "";
    return {
      id: q.id, number: q.number, title: q.title || "", client: q.client?.company || q.client?.contact || "",
      qty, techniques: Object.keys(byTech), mainTechnique: main, suggested,
      deadline: q.deadline || null, stage: q.production?.stage || "a_lancer",
      plannedDate: q.production?.plannedDate || "", machine: q.production?.machine || "",
      ready: !!(q.production?.purchasedAt || (q.lines || []).every(l => l.supplied || l.kind === "print" || l.ordered)),
      batValidated: (q.bats || []).some(b => b.status === "valide"),
    };
  }
  const plannable = () => db.get("quotes").filter(q => ["accepte", "production"].includes(q.status) && PLANNABLE.includes(q.production?.stage || "a_lancer"));

  router.get("/planning", requireAdmin, (_req, res) => {
    const s = db.get("settings");
    res.json({ machines: s.machines || [], weekends: !!s.planningWeekends, jobs: plannable().map(jobOf) });
  });

  router.patch("/quotes/:id/planning", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const machines = db.get("settings").machines || [];
    const out = db.update("quotes", qs => {
      const q = qs.find(x => x.id === req.params.id);
      if (!q) return null;
      const p = q.production ||= { stage: "a_lancer", since: Date.now(), mode: "expedition" };
      if ("plannedDate" in b) p.plannedDate = isYmd(b.plannedDate) ? b.plannedDate : "";
      if ("machine" in b) p.machine = machines.some(m => m.id === b.machine) ? b.machine : "";
      const m = machines.find(x => x.id === p.machine);
      ctx.logQuote(q, "production", p.plannedDate ? `Planifié le ${p.plannedDate.split("-").reverse().join("/")}${m ? ` sur ${m.name}` : ""}` : "Retiré du planning");
      q.updatedAt = Date.now();
      return jobOf(q);
    });
    out ? res.json(out) : res.status(404).json({ error: "Devis introuvable" });
  }));

  // Place automatiquement les commandes non planifiées : par échéance, sur la machine adaptée, au premier jour libre
  router.post("/planning/auto", requireAdmin, wrap((req, res) => {
    const s = db.get("settings");
    const machines = s.machines || [];
    if (!machines.length) throw new Error("Déclarez d'abord vos machines (Paramètres › Atelier).");
    const lead = Math.max(0, Number(s.planningLeadDays ?? 3));
    const jobs = plannable().map(jobOf);
    const load = {}; // machine|date → pièces
    for (const j of jobs) if (j.plannedDate && j.machine) load[`${j.machine}|${j.plannedDate}`] = (load[`${j.machine}|${j.plannedDate}`] || 0) + j.qty;
    const todo = jobs.filter(j => !j.plannedDate).sort((a, b) => (a.deadline || 9e15) - (b.deadline || 9e15));
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const placed = [];
    for (const j of todo) {
      const m = machines.find(x => x.id === (j.machine || j.suggested)) || machines[0];
      const cap = Math.max(1, Number(m.capacity) || 100);
      let d = new Date(today.getTime() + (j.ready ? 0 : lead) * DAY);
      for (let i = 0; i < 120; i++, d = new Date(d.getTime() + DAY)) {
        if (!s.planningWeekends && [0, 6].includes(d.getDay())) continue;
        const k = `${m.id}|${ymd(d)}`;
        const used = load[k] || 0;
        if (used + j.qty <= cap || used === 0) { load[k] = used + j.qty; placed.push({ id: j.id, plannedDate: ymd(d), machine: m.id }); break; }
      }
    }
    db.update("quotes", qs => {
      for (const p of placed) {
        const q = qs.find(x => x.id === p.id);
        const pr = q.production ||= { stage: "a_lancer", since: Date.now(), mode: "expedition" };
        Object.assign(pr, { plannedDate: p.plannedDate, machine: p.machine });
        ctx.logQuote(q, "production", `Planifié automatiquement le ${p.plannedDate.split("-").reverse().join("/")}`);
      }
    });
    res.json({ placed: placed.length });
  }));

  router.put("/machines", requireAdmin, wrap((req, res) => {
    const list = (Array.isArray(req.body?.machines) ? req.body.machines : []).map(m => ({
      id: clean(m.id, 40) || uid("m"), name: clean(m.name, 120).trim(), capacity: Math.max(1, parseInt(m.capacity, 10) || 100),
      techniques: (Array.isArray(m.techniques) ? m.techniques : []).map(t => clean(t, 60)),
    })).filter(m => m.name);
    db.update("settings", s => {
      s.machines = list;
      if ("weekends" in req.body) s.planningWeekends = !!req.body.weekends;
      if ("leadDays" in req.body) s.planningLeadDays = Math.max(0, parseInt(req.body.leadDays, 10) || 0);
    });
    res.json(list);
  }));

  /* ================= STOCK ================= */
  const itemFields = b => ({
    kind: b.kind === "consommable" ? "consommable" : "article",
    ref: clean(b.ref, 80).trim(), name: clean(b.name, 200).trim(), color: clean(b.color, 80).trim(), size: clean(b.size, 40).trim(),
    unit: clean(b.unit, 20).trim() || (b.kind === "consommable" ? "u." : "pcs"),
    min: Math.max(0, Number(b.min) || 0), location: clean(b.location, 120), notes: clean(b.notes, 1000),
    articleId: clean(b.articleId, 60),
  });
  function checkLow(item) {
    const prefix = `stock:${item.id}:low`;
    if (item.min > 0 && item.qty <= item.min) {
      if (!db.get("tasks").some(t => !t.done && t.key?.startsWith(prefix))) {
        ctx.addTask({ key: `${prefix}:${Date.now()}`, auto: true, priority: "high", title: `Stock bas : ${item.name || item.ref}${item.color ? ` ${item.color}` : ""}${item.size ? ` ${item.size}` : ""} (${item.qty} ${item.unit} restant${item.qty > 1 ? "s" : ""}, seuil ${item.min})` });
      }
    } else ctx.completeTasks(prefix);
  }
  function move(itemId, delta, reason, extra = {}) {
    const item = db.update("stock", l => {
      const it = l.find(x => x.id === itemId);
      if (!it) return null;
      it.qty = Math.round(((it.qty || 0) + delta) * 1000) / 1000;
      it.updatedAt = Date.now();
      return { ...it };
    });
    if (!item) throw Object.assign(new Error("Article de stock introuvable"), { status: 404 });
    db.update("stockmoves", l => { l.push({ id: uid("sm"), at: Date.now(), itemId, delta, qtyAfter: item.qty, reason: clean(reason, 300), ...extra }); if (l.length > 50000) l.splice(0, l.length - 50000); });
    checkLow(item);
    return item;
  }

  router.get("/stock", requireAdmin, (_req, res) => res.json(db.get("stock")));
  router.get("/stock/moves", requireAdmin, (req, res) => {
    const id = req.query.item;
    res.json(db.get("stockmoves").filter(m => !id || m.itemId === id).slice(-300).reverse());
  });
  router.post("/stock", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const f = itemFields(b);
    if (!f.name && !f.ref) throw new Error("Nom ou référence requis");
    const item = { id: uid("st"), createdAt: Date.now(), qty: 0, ...f };
    db.update("stock", l => l.push(item));
    const q0 = Number(b.qty) || 0;
    res.json(q0 ? move(item.id, q0, "Stock initial", { user: req.user?.name }) : item);
  }));
  router.put("/stock/:id", requireAdmin, wrap((req, res) => {
    const f = itemFields(req.body || {});
    const item = db.update("stock", l => { const it = l.find(x => x.id === req.params.id); if (it) Object.assign(it, f, { updatedAt: Date.now() }); return it && { ...it }; });
    if (!item) return res.status(404).json({ error: "Introuvable" });
    checkLow(item);
    res.json(item);
  }));
  router.delete("/stock/:id", requireAdmin, (req, res) => {
    db.set("stock", db.get("stock").filter(x => x.id !== req.params.id));
    ctx.completeTasks(`stock:${req.params.id}:low`);
    res.json({ ok: true });
  });
  // { delta } ajoute/retire, { count } = inventaire (quantité comptée)
  router.post("/stock/:id/move", requireAdmin, wrap((req, res) => {
    const it = db.get("stock").find(x => x.id === req.params.id);
    if (!it) return res.status(404).json({ error: "Introuvable" });
    const b = req.body || {};
    const delta = "count" in b ? (Number(b.count) || 0) - (it.qty || 0) : Number(b.delta) || 0;
    if (!delta) return res.json(it);
    res.json(move(it.id, delta, b.reason || ("count" in b ? "Inventaire" : delta > 0 ? "Entrée" : "Sortie"), { user: req.user?.name }));
  }));

  /** Au lancement du marquage, les pièces disponibles en stock sont déduites (une seule fois par devis). */
  ctx.deductStock = q => {
    if (q.production?.stockDeducted) return [];
    const stock = db.get("stock");
    const kept = new Set((q.computed?.lines || []).map(l => l.id));
    const used = [];
    for (const l of q.lines || []) {
      if (l.supplied || l.kind === "print" || !kept.has(l.id)) continue;
      for (const [size, n] of Object.entries(l.sizes || {})) {
        let need = parseInt(n, 10) || 0;
        for (const it of stock.filter(x => x.kind !== "consommable" && x.qty > 0 && norm(x.ref) === norm(l.ref) && norm(x.color) === norm(l.color) && norm(x.size) === norm(size))) {
          if (need <= 0) break;
          const take = Math.min(need, it.qty);
          move(it.id, -take, `Utilisé pour ${q.number}`, { quoteId: q.id });
          it.qty -= take; need -= take;
          used.push({ ref: l.ref, color: l.color, size, qty: take });
        }
      }
    }
    q.production.stockDeducted = Date.now();
    if (used.length) ctx.logQuote(q, "production", `Stock utilisé : ${used.map(u => `${u.qty} × ${u.ref} ${u.color} ${u.size}`).join(", ")}`);
    return used;
  };
}
