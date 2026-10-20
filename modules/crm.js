/* CRM : contacts, historique, activités, tâches, emails, demandes de devis (formulaire public). */
import { uid, clean, cleanFiles, saveDataUrl, normEmail } from "./core.js";

const SIGNED = ["accepte", "production", "expedie", "livre"];
const CONTACT_FIELDS = ["company", "contact", "email", "phone", "mobile", "address", "zip", "city", "vatNumber", "siret", "website",
  "type", "tags", "source", "sector", "notes", "discountPct", "birthday", "status"];
const pickContact = b => Object.fromEntries(CONTACT_FIELDS.filter(k => k in b).map(k => [k,
  k === "tags" ? (Array.isArray(b.tags) ? b.tags.map(t => clean(t, 40)).filter(Boolean).slice(0, 20) : [])
    : k === "discountPct" ? (Number(b[k]) || 0) : k === "email" ? normEmail(b[k]) : clean(b[k], k === "notes" ? 5000 : 300)]));

/* Limiteur simple en mémoire pour les routes publiques (anti-spam). */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return true;
}

/** Interprète une répartition saisie librement : « S:10, M 20, L=15 » → { S:10, M:20, L:15 } */
export function parseSizes(text) {
  const out = {};
  for (const m of String(text || "").matchAll(/([A-Za-z0-9]{1,6}(?:\s?ans)?)\s*[:=x×\s-]\s*(\d{1,5})/gi)) {
    const size = m[1].toUpperCase().replace(/\s+/g, " ");
    out[size] = (out[size] || 0) + parseInt(m[2], 10);
  }
  return out;
}

export function crmRoutes(router, ctx) {
  const { db, mail, requireAdmin, wrap } = ctx;

  /* -------- Statistiques d'un contact -------- */
  const quotesOf = (c, quotes) => quotes.filter(q => q.clientId === c.id || (c.email && normEmail(q.client?.email) === normEmail(c.email)));
  function contactStats(c, quotes) {
    const qs = quotesOf(c, quotes);
    const signed = qs.filter(q => SIGNED.includes(q.status));
    const sent = qs.filter(q => q.sentAt || SIGNED.includes(q.status) || q.status === "refuse");
    const reviews = qs.filter(q => q.review);
    const ca = signed.reduce((s, q) => s + (q.computed?.totals?.ht || 0), 0);
    return {
      quotes: qs.length, signed: signed.length, ca, avgBasket: signed.length ? ca / signed.length : 0,
      conversion: sent.length ? Math.round(signed.length / sent.length * 100) : null,
      pending: qs.filter(q => q.status === "envoye").reduce((s, q) => s + (q.computed?.totals?.ht || 0), 0),
      lastOrderAt: Math.max(0, ...signed.map(q => q.acceptedAt || q.acceptance?.at || q.updatedAt)) || null,
      lastQuoteAt: Math.max(0, ...qs.map(q => q.createdAt)) || null,
      rating: reviews.length ? Math.round(reviews.reduce((s, q) => s + q.review.rating, 0) / reviews.length * 10) / 10 : null,
    };
  }

  /* ================= CONTACTS ================= */
  router.get("/clients", requireAdmin, (_req, res) => {
    const quotes = db.get("quotes");
    const tasks = db.get("tasks").filter(t => !t.done);
    res.json(db.get("clients").map(c => ({ ...c, stats: contactStats(c, quotes), openTasks: tasks.filter(t => t.clientId === c.id).length })));
  });

  router.post("/clients", requireAdmin, wrap((req, res) => {
    const data = pickContact(req.body || {});
    if (!data.company && !data.contact && !data.email) throw new Error("Indiquez au moins une société, un contact ou un email.");
    if (data.email && ctx.findClientByEmail(data.email)) throw new Error("Un contact existe déjà avec cet email.");
    const c = { id: uid("c"), createdAt: Date.now(), type: "client", tags: [], discountPct: 0, ...data };
    db.update("clients", l => l.push(c));
    ctx.addActivity({ type: "system", clientId: c.id, text: "Fiche contact créée" });
    res.json(c);
  }));

  router.put("/clients/:id", requireAdmin, wrap((req, res) => {
    const c = db.update("clients", list => {
      const x = list.find(y => y.id === req.params.id);
      if (!x) return null;
      Object.assign(x, pickContact(req.body || {}), { updatedAt: Date.now() });
      return x;
    });
    if (!c) return res.status(404).json({ error: "Contact introuvable" });
    res.json(c);
  }));

  router.delete("/clients/:id", requireAdmin, (req, res) => {
    db.set("clients", db.get("clients").filter(x => x.id !== req.params.id));
    db.update("quotes", qs => qs.forEach(q => { if (q.clientId === req.params.id) q.clientId = null; }));
    res.json({ ok: true });
  });

  // Fusion de doublons : tout ce qui pointe vers `otherId` est rattaché à `id`
  router.post("/clients/:id/merge", requireAdmin, wrap((req, res) => {
    const { otherId } = req.body || {};
    const list = db.get("clients");
    const a = list.find(x => x.id === req.params.id), b = list.find(x => x.id === otherId);
    if (!a || !b || a === b) throw new Error("Contacts invalides");
    for (const k of CONTACT_FIELDS) if ((a[k] === undefined || a[k] === "" || a[k] === null) && b[k]) a[k] = b[k];
    a.tags = [...new Set([...(a.tags || []), ...(b.tags || [])])];
    a.notes = [a.notes, b.notes].filter(Boolean).join("\n");
    db.set("clients", list.filter(x => x.id !== otherId));
    for (const coll of ["quotes", "activities", "tasks", "requests", "prospects"]) {
      db.update(coll, xs => xs.forEach(x => { if (x.clientId === otherId) x.clientId = a.id; }));
    }
    ctx.addActivity({ type: "system", clientId: a.id, text: `Fiche fusionnée avec « ${b.company || b.contact || b.email} »` });
    res.json(a);
  }));

  // Import de contacts (CSV côté navigateur) : fusion par email
  router.post("/clients/import", requireAdmin, wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 10000) : [];
    let added = 0, updated = 0;
    db.update("clients", list => {
      for (const raw of items) {
        const it = pickContact(raw);
        if (!it.company && !it.contact && !it.email) continue;
        const ex = it.email && list.find(c => normEmail(c.email) === it.email);
        if (ex) { for (const [k, v] of Object.entries(it)) if (v !== "" && !(Array.isArray(v) && !v.length)) ex[k] = v; updated++; }
        else { list.push({ id: uid("c"), createdAt: Date.now(), type: "client", tags: [], discountPct: 0, ...it, source: it.source || "import" }); added++; }
      }
    });
    res.json({ added, updated });
  }));

  // Fiche contact complète : devis, demandes, tâches, chronologie fusionnée
  router.get("/clients/:id", requireAdmin, wrap((req, res) => {
    const c = db.get("clients").find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "Contact introuvable" });
    const quotes = db.get("quotes");
    const qs = quotesOf(c, quotes);
    const requests = db.get("requests").filter(r => r.clientId === c.id || (c.email && normEmail(r.contact?.email) === normEmail(c.email)));
    const qIds = new Set(qs.map(q => q.id));
    const numbers = Object.fromEntries(qs.map(q => [q.id, q.number]));
    // les évènements de devis viennent de l'historique du devis : on n'en garde pas de doublon côté activités
    const dup = new Set(["system", "won", "lost", "message_in"]);
    const timeline = [
      ...db.get("activities").filter(a => (a.clientId === c.id || (a.quoteId && qIds.has(a.quoteId))) && !(a.quoteId && qIds.has(a.quoteId) && dup.has(a.type)))
        .map(a => ({ ...a, number: numbers[a.quoteId] })),
      ...qs.flatMap(q => (q.history || []).map(h => ({ ...h, id: "h" + h.id, quoteId: q.id, number: q.number, type: "quote_" + h.type, source: "quote" }))),
      ...requests.map(r => ({ id: "r" + r.id, at: r.createdAt, type: "request", requestId: r.id, text: `Demande ${r.number} reçue (${r.source === "form" ? "formulaire" : r.source})` })),
    ].sort((x, y) => y.at - x.at).slice(0, 400);
    const prospect = db.get("prospects").find(p => p.clientId === c.id || (c.email && normEmail(p.email) === normEmail(c.email)));
    res.json({
      client: c, stats: contactStats(c, quotes), quotes: qs.map(ctx.quoteSummary).sort((a, b) => b.createdAt - a.createdAt),
      requests: requests.sort((a, b) => b.createdAt - a.createdAt), tasks: enrichTasks(db.get("tasks").filter(t => t.clientId === c.id)),
      timeline, prospect: prospect ? { id: prospect.id, status: prospect.status, sequenceId: prospect.sequenceId } : null,
      optedOut: db.get("optout").some(o => o.email === normEmail(c.email)),
    });
  }));

  /* ================= ACTIVITÉS & EMAILS ================= */
  router.post("/activities", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    if (!["note", "call", "meeting", "email_out", "email_in", "visit"].includes(b.type)) throw new Error("Type d'activité invalide");
    const text = clean(b.text, 5000).trim();
    if (!text) throw new Error("Texte vide");
    const a = ctx.addActivity({ type: b.type, text, clientId: b.clientId || null, quoteId: b.quoteId || null, requestId: b.requestId || null, prospectId: b.prospectId || null, outcome: clean(b.outcome, 100) });
    res.json(a);
  }));
  router.delete("/activities/:id", requireAdmin, (req, res) => {
    db.set("activities", db.get("activities").filter(a => a.id !== req.params.id));
    res.json({ ok: true });
  });

  router.post("/emails/send", requireAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const to = normEmail(b.to);
    if (!to) throw new Error("Destinataire manquant");
    const subject = clean(b.subject, 300), text = clean(b.text, 20000);
    await mail.send({ to, subject, text, cc: clean(b.cc, 300) || undefined });
    const a = ctx.addActivity({ type: "email_out", text: `Email envoyé à ${to} : « ${subject} »`, subject, body: text.slice(0, 4000),
      clientId: b.clientId || ctx.findClientByEmail(to)?.id || null, quoteId: b.quoteId || null, requestId: b.requestId || null, prospectId: b.prospectId || null });
    res.json(a);
  }));

  /* ================= TÂCHES ================= */
  /** Ajoute aux tâches les noms lisibles des éléments liés (contact, devis, demande, prospect). */
  function enrichTasks(tasks) {
    const clients = db.get("clients"), quotes = db.get("quotes"), requests = db.get("requests"), prospects = db.get("prospects");
    return tasks.map(t => ({
      ...t,
      clientName: (() => { const c = clients.find(x => x.id === t.clientId); return c ? c.company || c.contact : ""; })(),
      quoteNumber: quotes.find(x => x.id === t.quoteId)?.number || "",
      requestNumber: requests.find(x => x.id === t.requestId)?.number || "",
      prospectName: prospects.find(x => x.id === t.prospectId)?.company || "",
    })).sort((a, b) => (a.done - b.done) || (a.due - b.due));
  }
  router.get("/tasks", requireAdmin, (_req, res) => res.json(enrichTasks(db.get("tasks"))));
  router.post("/tasks", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    if (!clean(b.title).trim()) throw new Error("Titre manquant");
    res.json(ctx.addTask({ title: b.title, due: Number(b.due) || Date.now(), priority: b.priority === "high" ? "high" : "normal",
      clientId: b.clientId || null, quoteId: b.quoteId || null, requestId: b.requestId || null, prospectId: b.prospectId || null, notes: clean(b.notes, 2000) }));
  }));
  router.put("/tasks/:id", requireAdmin, wrap((req, res) => {
    const t = db.update("tasks", list => {
      const x = list.find(y => y.id === req.params.id);
      if (!x) return null;
      for (const k of ["title", "due", "priority", "notes", "done", "clientId", "quoteId", "requestId"]) if (k in req.body) x[k] = req.body[k];
      if ("done" in req.body) x.doneAt = req.body.done ? Date.now() : null;
      return x;
    });
    if (!t) return res.status(404).json({ error: "Tâche introuvable" });
    if (req.body.done && t.clientId) ctx.addActivity({ type: "task_done", clientId: t.clientId, quoteId: t.quoteId, text: `Tâche terminée : ${t.title}` });
    res.json(t);
  }));
  router.delete("/tasks/:id", requireAdmin, (req, res) => { db.set("tasks", db.get("tasks").filter(t => t.id !== req.params.id)); res.json({ ok: true }); });

  /* ================= DEMANDES DE DEVIS ================= */
  const nextRequestNumber = () => {
    const s = db.get("settings");
    const n = s.nextRequestNumber || 1;
    db.set("settings", { ...s, nextRequestNumber: n + 1 });
    return `DEM-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
  };
  const cleanItems = items => (Array.isArray(items) ? items : []).slice(0, 20).map(it => ({
    product: clean(it.product, 120), articleId: clean(it.articleId, 60), color: clean(it.color, 80),
    quantity: Math.max(0, Math.min(100000, parseInt(it.quantity, 10) || 0)), sizes: clean(it.sizes, 300),
    notes: clean(it.notes, 1000),
    universe: ["objet", "print"].includes(it.universe) ? it.universe : "textile",
    formatId: clean(it.formatId, 40), options: (Array.isArray(it.options) ? it.options : []).slice(0, 12).map(x => clean(x, 40)),
    w: Number(it.w) > 0 ? Math.min(1000, Number(it.w)) : null, h: Number(it.h) > 0 ? Math.min(1000, Number(it.h)) : null,
    fileStatus: ["pret", "a_creer"].includes(it.fileStatus) ? it.fileStatus : "",
    positions: (Array.isArray(it.positions) ? it.positions : []).slice(0, 8).map(p => ({
      position: clean(p.position, 80), w: Number(p.w) > 0 ? Math.min(200, Number(p.w)) : null, h: Number(p.h) > 0 ? Math.min(200, Number(p.h)) : null,
      technique: clean(p.technique, 60), colors: Math.max(1, Math.min(12, parseInt(p.colors, 10) || 1)),
    })),
  })).filter(it => it.product || it.quantity || it.positions.length);

  /** Crée une demande (formulaire public, saisie manuelle ou email entrant). */
  ctx.createRequest = (b, { source = "form", req } = {}) => {
    const contact = {
      company: clean(b.contact?.company, 200), contact: clean(b.contact?.contact, 200), email: normEmail(b.contact?.email),
      phone: clean(b.contact?.phone, 40), zip: clean(b.contact?.zip, 20), city: clean(b.contact?.city, 120),
    };
    const client = ctx.ensureClient(contact, { type: "prospect", source: source === "form" ? "formulaire" : source });
    const r = {
      id: uid("r"), number: nextRequestNumber(), createdAt: Date.now(), updatedAt: Date.now(), status: "nouvelle", source,
      contact, clientId: client?.id || null, items: cleanItems(b.items), subject: clean(b.subject, 200),
      deadline: Number(b.deadline) || null, budget: clean(b.budget, 60), event: clean(b.event, 200), message: clean(b.message, 10000),
      files: cleanFiles(b.files, 12), quoteId: null, notes: "", emailRef: b.emailRef || null,
    };
    db.update("requests", l => l.push(r));
    // un prospect qui fait une demande sort des campagnes
    db.update("prospects", ps => ps.forEach(p => { if (contact.email && normEmail(p.email) === contact.email && !["converti", "desinscrit"].includes(p.status)) { p.status = "interesse"; p.nextAt = null; p.clientId = client?.id; } }));
    ctx.addActivity({ type: "request", clientId: r.clientId, requestId: r.id, text: `Nouvelle demande ${r.number}${r.subject ? ` : ${r.subject}` : ""}` });
    const hours = db.get("settings").automation.requestResponseHours || 24;
    ctx.addTask({ key: `request:${r.id}:answer`, title: `Répondre à la demande ${r.number} — ${contact.company || contact.contact || contact.email}`, requestId: r.id, clientId: r.clientId, due: Date.now() + hours * 36e5, auto: true, priority: "high" });
    return r;
  };

  router.get("/requests", requireAdmin, (_req, res) => res.json(db.get("requests").sort((a, b) => b.createdAt - a.createdAt)));
  router.post("/requests", requireAdmin, wrap((req, res) => res.json(ctx.createRequest(req.body || {}, { source: req.body?.source || "manuel" }))));
  router.put("/requests/:id", requireAdmin, wrap((req, res) => {
    const r = db.update("requests", list => {
      const x = list.find(y => y.id === req.params.id);
      if (!x) return null;
      if (req.body.status && ["nouvelle", "en_cours", "devis", "gagnee", "perdue", "archivee"].includes(req.body.status)) x.status = req.body.status;
      for (const k of ["notes", "lostReason", "subject", "budget"]) if (k in req.body) x[k] = clean(req.body[k], 5000);
      if ("items" in req.body) x.items = cleanItems(req.body.items);
      if ("deadline" in req.body) x.deadline = Number(req.body.deadline) || null;
      x.updatedAt = Date.now();
      return x;
    });
    if (!r) return res.status(404).json({ error: "Demande introuvable" });
    if (["perdue", "archivee"].includes(r.status)) ctx.completeTasks(`request:${r.id}:`);
    if (r.status === "perdue") ctx.addActivity({ type: "lost", clientId: r.clientId, requestId: r.id, text: `Demande ${r.number} perdue${r.lostReason ? ` (${r.lostReason})` : ""}` });
    res.json(r);
  }));
  router.delete("/requests/:id", requireAdmin, (req, res) => {
    db.set("requests", db.get("requests").filter(r => r.id !== req.params.id));
    ctx.completeTasks(`request:${req.params.id}:`);
    res.json({ ok: true });
  });

  // Transforme une demande en devis pré-rempli (articles, tailles, marquages, visuels)
  router.post("/requests/:id/convert", requireAdmin, wrap((req, res) => {
    const r = db.get("requests").find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "Demande introuvable" });
    if (r.quoteId && db.get("quotes").some(q => q.id === r.quoteId)) return res.json({ id: r.quoteId, existing: true });
    const catalog = db.get("catalog"), techniques = db.get("techniques");
    const totalQty = r.items.reduce((s, it) => s + it.quantity, 0);
    const uni = x => x.universe || "textile";
    const findTech = (name, universe, qty) => {
      const pool = techniques.filter(x => uni(x) === universe);
      const n = String(name || "").toLowerCase();
      const t = n && pool.find(x => x.id === n || x.name.toLowerCase() === n || x.name.toLowerCase().includes(n) || n.includes(x.id));
      if (t) return t;
      // conseil par défaut : sérigraphie dès 25 pièces (sinon transfert) ; tampographie dès 100 objets (sinon UV)
      const pref = universe === "objet" ? (qty >= 100 ? "tampo" : "uv") : (totalQty >= 25 ? "serigraphie" : "dtf");
      return pool.find(x => x.id === pref) || pool[0] || techniques[0];
    };
    const lines = r.items.map((it, i) => {
      if (it.universe === "print") {
        const t = findTech(it.product, "print", it.quantity);
        const options = [...it.options];
        if (it.fileStatus === "a_creer" && t?.options?.some(o => o.id === "crea") && !options.includes("crea")) options.push("crea");
        return {
          id: uid("l"), kind: "print", universe: "print", supplied: true, name: t?.name || it.product || "Impression", ref: "", image: "",
          availableSizes: ["Quantité"], sizes: { "Quantité": it.quantity || 0 }, colors: [], color: "",
          note: [it.notes, it.fileStatus === "pret" ? "Fichier fourni par le client" : it.fileStatus === "a_creer" ? "Création graphique demandée" : ""].filter(Boolean).join(" — "),
          perso: t ? [{ id: uid("p"), techniqueId: t.id, position: "", w: it.w ?? "", h: it.h ?? "", formatId: it.formatId || "", colors: 1, design: `Visuel ${i + 1}`, options: options.filter(id => t.options?.some(o => o.id === id)) }] : [],
        };
      }
      const pool = catalog.filter(x => uni(x) === it.universe);
      const prod = (it.product || "").toLowerCase();
      const exact = catalog.find(x => x.id === it.articleId) || pool.find(x => prod && (x.ref?.toLowerCase() === prod || x.name.toLowerCase() === prod));
      // sinon : première référence de la catégorie demandée (modèle à confirmer)
      const a = exact || pool.find(x => prod && x.category?.toLowerCase() === prod);
      const sizes = parseSizes(it.sizes);
      const sum = Object.values(sizes).reduce((s, n) => s + n, 0);
      let availableSizes = a?.sizes?.length ? [...a.sizes] : ["Unique"];
      for (const s of Object.keys(sizes)) if (!availableSizes.includes(s)) availableSizes.push(s);
      if (it.quantity > sum) { // reste non réparti
        const k = sum ? "À répartir" : (availableSizes.length === 1 ? availableSizes[0] : "À répartir");
        if (!availableSizes.includes(k)) availableSizes.push(k);
        sizes[k] = (sizes[k] || 0) + it.quantity - sum;
      }
      return {
        id: uid("l"), universe: it.universe, articleId: a?.id || null, ref: a?.ref || "", name: a?.name || it.product || `Article ${i + 1}`, brand: a?.brand || "",
        image: a?.image || "", cost: a?.cost ?? 0, coef: a?.coef ?? null, salePrice: a?.salePrice ?? null, sizeSurcharges: a?.sizeSurcharges || {},
        availableSizes, colors: a?.colors || (it.color ? [it.color] : []), color: it.color || a?.colors?.[0] || "", sizes,
        note: [it.notes, !exact && it.product ? (a ? `Modèle proposé pour « ${it.product} » — à confirmer` : "Article à confirmer") : ""].filter(Boolean).join(" — "),
        perso: it.positions.map(p => ({ id: uid("p"), techniqueId: findTech(p.technique, it.universe, it.quantity).id, position: p.position, w: p.w ?? "", h: p.h ?? "", formatId: "", colors: p.colors || 1, design: "Logo" })),
      };
    });
    const c = r.clientId ? db.get("clients").find(x => x.id === r.clientId) : null;
    const q = ctx.createQuote({
      title: r.subject || r.event || `Demande ${r.number}`, requestId: r.id, clientId: r.clientId,
      client: { ...r.contact, address: c?.address || "", vatNumber: c?.vatNumber || "" }, lines, deadline: r.deadline,
      discountPct: c?.discountPct || 0, files: r.files.map(f => ({ ...f, at: r.createdAt, from: "client" })),
      internalNotes: [r.message && `Message du client : ${r.message}`, r.budget && `Budget indiqué : ${r.budget}`].filter(Boolean).join("\n"),
    });
    db.update("requests", list => { const x = list.find(y => y.id === r.id); x.quoteId = q.id; x.status = "en_cours"; x.updatedAt = Date.now(); });
    ctx.addActivity({ type: "system", clientId: r.clientId, requestId: r.id, quoteId: q.id, text: `Devis ${q.number} créé depuis la demande ${r.number}` });
    res.json({ id: q.id });
  }));

  /* ================= FORMULAIRE PUBLIC ================= */
  router.get("/public/form", (_req, res) => {
    const s = db.get("settings");
    const catalog = db.get("catalog");
    const catsOf = u => [...new Set(catalog.filter(a => (a.universe || "textile") === u).map(a => a.category).filter(Boolean))];
    res.json({
      company: { name: s.company.name, logo: s.company.logo, phone: s.company.phone, email: s.company.email, website: s.company.website },
      categories: catsOf("textile").length ? catsOf("textile") : ["T-shirt", "Polo", "Sweat", "Veste", "Casquette", "Sac"],
      objectCategories: catsOf("objet"),
      catalog: catalog.map(a => ({ id: a.id, universe: a.universe || "textile", name: a.name, ref: a.ref, brand: a.brand, category: a.category, image: a.image, colors: a.colors, sizes: a.sizes })),
      techniques: db.get("techniques").map(t => ({ id: t.id, universe: t.universe || "textile", name: t.name, description: t.description,
        ...(t.universe === "print" ? { formats: (t.formats || []).map(f => ({ id: f.id, label: f.label })), minQty: t.minQty || 1,
          options: (t.options || []).filter(o => o.id !== "crea").map(o => ({ id: o.id, label: o.label, group: o.group || "" })) } : {}) })),
      positions: s.positions, intro: s.formIntro || "",
    });
  });

  router.post("/public/form/upload", wrap((req, res) => {
    if (!rateLimit("up:" + req.ip, 60, 36e5)) return res.status(429).json({ error: "Trop d'envois, réessayez plus tard." });
    res.json({ ...saveDataUrl(ctx.uploadsDir, req.body?.dataUrl, { maxMb: 15 }), name: clean(req.body?.name, 200) });
  }));

  router.post("/public/request", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // pot de miel anti-robot
    if (!rateLimit("rq:" + req.ip, 20, 36e5)) return res.status(429).json({ error: "Trop de demandes envoyées, réessayez plus tard ou contactez-nous." });
    const email = normEmail(b.contact?.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adresse email invalide.");
    if (!clean(b.contact?.contact).trim() && !clean(b.contact?.company).trim()) throw new Error("Indiquez votre nom ou votre structure.");
    if (!b.consent) throw new Error("Merci d'accepter que nous utilisions vos informations pour vous répondre.");
    if (!cleanItems(b.items).length && !clean(b.message).trim()) throw new Error("Décrivez votre besoin (articles ou message).");
    const r = ctx.createRequest(b, { source: "form", req });
    const s = db.get("settings");
    const tpl = s.templates.request_ack;
    const vars = { contact: r.contact.contact, client: r.contact.company, numero: r.number, atelier: s.company.name, signature: s.emailSignature || s.company.name };
    if (await mail.trySend({ to: email, subject: mail.render(tpl.subject, vars), text: mail.render(tpl.body, vars) })) {
      ctx.addActivity({ type: "email_out", clientId: r.clientId, requestId: r.id, text: `Accusé de réception envoyé à ${email}` });
    }
    const qty = r.items.reduce((x, it) => x + it.quantity, 0);
    ctx.notifyAdmin(`📥 Nouvelle demande ${r.number} — ${r.contact.company || r.contact.contact}`,
      `${r.contact.contact} (${email}${r.contact.phone ? `, ${r.contact.phone}` : ""})\n${qty} pièce(s) · ${r.items.map(i => `${i.quantity}× ${i.product}`).join(", ")}\n\n${r.message}`, `/demandes/${r.id}`, req);
    res.json({ ok: true, number: r.number });
  }));
}

