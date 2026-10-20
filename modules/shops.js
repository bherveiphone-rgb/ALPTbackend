/* Boutiques club : page de commande en ligne pour les membres d'un club / d'une entreprise,
   paiement par carte (Stripe) ou auprès du club, puis commande regroupée pour l'atelier. */
import { uid, token, clean, normEmail } from "./core.js";
import { r2, fmtEUR } from "../public/devis/pricing.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function shopRoutes(router, ctx) {
  const { db, requireAdmin, wrap, mail } = ctx;
  const shopLink = (s, req) => `${ctx.baseUrl(req)}/devis/boutique.html?b=${s.token}`;
  const cleanProducts = list => (Array.isArray(list) ? list : []).slice(0, 40).map(p => ({
    id: p.id || uid("sp"), name: clean(p.name, 150), description: clean(p.description, 500), image: clean(p.image, 300),
    price: Math.max(0, r2(Number(p.price) || 0)), sizes: (Array.isArray(p.sizes) ? p.sizes : []).map(x => clean(x, 20)).filter(Boolean).slice(0, 20),
    colors: (Array.isArray(p.colors) ? p.colors : []).map(x => clean(x, 40)).filter(Boolean).slice(0, 12),
    persoName: !!p.persoName, persoNumber: !!p.persoNumber, persoPrice: Math.max(0, r2(Number(p.persoPrice) || 0)),
    line: p.line && typeof p.line === "object" ? p.line : null, // modèle de ligne de devis (article + marquages)
  })).filter(p => p.name);
  const stats = (s, orders) => {
    const os = orders.filter(o => o.shopId === s.id && o.status !== "annulee");
    return { orders: os.length, paid: os.filter(o => o.payment.status === "paid").length, total: r2(os.reduce((x, o) => x + o.total, 0)),
      pieces: os.reduce((x, o) => x + o.items.reduce((y, i) => y + i.qty, 0), 0) };
  };

  /* ================= ADMIN ================= */
  router.get("/shops", requireAdmin, (req, res) => {
    const orders = db.get("shopOrders");
    res.json(db.get("shops").map(s => ({ ...s, link: shopLink(s, req), stats: stats(s, orders) })).sort((a, b) => b.createdAt - a.createdAt));
  });

  // Crée une boutique à partir d'un devis : chaque ligne devient un produit (prix TTC unitaire du devis)
  router.post("/shops", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    let products = cleanProducts(b.products);
    let clientId = b.clientId || null, title = clean(b.title, 150);
    if (b.fromQuoteId) {
      const q = db.get("quotes").find(x => x.id === b.fromQuoteId);
      if (!q) throw new Error("Devis introuvable");
      clientId ||= q.clientId; title ||= q.client?.company || q.title || q.number;
      const vat = (q.computed?.totals?.vatRate ?? 20) / 100;
      const margin = Number(b.marginPct) || 0;
      products = (q.computed?.lines || []).map(l => {
        const src = q.lines.find(x => x.id === l.id) || {};
        const unitTtc = l.unit * (1 + vat) * (1 + margin / 100);
        return { id: uid("sp"), name: l.name, description: l.persos.map(p => `${p.techniqueName} ${p.position}`.trim()).join(" + "), image: l.image,
          price: Math.ceil(unitTtc * 2) / 2, // arrondi au 0,50 € supérieur
          sizes: (src.availableSizes || []).filter(x => x !== "À répartir"), colors: l.color ? [l.color] : [], persoName: false, persoNumber: false, persoPrice: 0,
          line: { ...structuredClone(src), sizes: {} } };
      });
    }
    const s = { id: uid("sh"), token: token(), createdAt: Date.now(), status: "open", title: title || "Boutique", intro: clean(b.intro, 2000),
      deadline: Number(b.deadline) || null, payment: ["online", "onsite", "both"].includes(b.payment) ? b.payment : "onsite", clientId, products, nextOrder: 1,
      contactEmail: normEmail(b.contactEmail) };
    db.update("shops", l => l.push(s));
    res.json({ ...s, link: shopLink(s, req) });
  }));

  router.put("/shops/:id", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const s = db.update("shops", l => {
      const x = l.find(y => y.id === req.params.id);
      if (!x) return null;
      if ("title" in b) x.title = clean(b.title, 150);
      if ("intro" in b) x.intro = clean(b.intro, 2000);
      if ("deadline" in b) x.deadline = Number(b.deadline) || null;
      if (["online", "onsite", "both"].includes(b.payment)) x.payment = b.payment;
      if (["open", "closed"].includes(b.status)) x.status = b.status;
      if ("products" in b) x.products = cleanProducts(b.products);
      if ("contactEmail" in b) x.contactEmail = normEmail(b.contactEmail);
      return x;
    });
    s ? res.json({ ...s, link: shopLink(s, req) }) : res.status(404).json({ error: "Boutique introuvable" });
  }));
  router.delete("/shops/:id", requireAdmin, (req, res) => {
    db.set("shops", db.get("shops").filter(s => s.id !== req.params.id));
    res.json({ ok: true });
  });
  router.get("/shops/:id/orders", requireAdmin, (req, res) => res.json(db.get("shopOrders").filter(o => o.shopId === req.params.id).sort((a, b) => b.createdAt - a.createdAt)));
  router.patch("/shops/:id/orders/:oid", requireAdmin, wrap((req, res) => {
    const o = db.update("shopOrders", l => {
      const x = l.find(y => y.id === req.params.oid && y.shopId === req.params.id);
      if (!x) return null;
      if (["paid", "pending"].includes(req.body?.payment)) x.payment = { ...x.payment, status: req.body.payment, at: Date.now() };
      if (req.body?.status === "annulee" || req.body?.status === "ok") x.status = req.body.status;
      return x;
    });
    o ? res.json(o) : res.status(404).json({ error: "Commande introuvable" });
  }));

  // Regroupe les commandes en un devis atelier (quantités par taille, liste des noms / numéros)
  router.post("/shops/:id/generate", requireAdmin, wrap((req, res) => {
    const s = db.get("shops").find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: "Boutique introuvable" });
    const onlyPaid = !!req.body?.onlyPaid;
    const orders = db.get("shopOrders").filter(o => o.shopId === s.id && o.status !== "annulee" && !o.exportedAt && (!onlyPaid || o.payment.status === "paid"));
    if (!orders.length) throw new Error("Aucune nouvelle commande à regrouper.");
    const lines = [];
    for (const p of s.products) {
      const items = orders.flatMap(o => o.items.filter(i => i.productId === p.id).map(i => ({ ...i, buyer: o.name })));
      if (!items.length) continue;
      const byColor = {};
      for (const i of items) (byColor[i.color || ""] ||= []).push(i);
      for (const [color, its] of Object.entries(byColor)) {
        const sizes = {};
        for (const i of its) sizes[i.size || "Unique"] = (sizes[i.size || "Unique"] || 0) + i.qty;
        const names = its.filter(i => i.persoName || i.persoNumber).map(i => `${i.size || ""} : ${[i.persoName, i.persoNumber].filter(Boolean).join(" n°")} (${i.buyer})`);
        const base = p.line ? structuredClone(p.line) : { name: p.name, availableSizes: p.sizes.length ? p.sizes : ["Unique"], perso: [] };
        lines.push({ ...base, id: uid("l"), color: color || base.color || "", sizes,
          availableSizes: [...new Set([...(base.availableSizes || []), ...Object.keys(sizes)])],
          perso: (base.perso || []).map(x => ({ ...x, id: uid("p") })),
          note: [base.note, names.length ? `Personnalisation : ${names.join(" ; ")}` : ""].filter(Boolean).join(" — ") });
      }
    }
    const c = s.clientId ? db.get("clients").find(x => x.id === s.clientId) : null;
    const q = ctx.createQuote({ title: `Boutique ${s.title} — ${orders.length} commande(s)`, clientId: s.clientId, client: c ? { company: c.company, contact: c.contact, email: c.email, phone: c.phone, address: c.address, zip: c.zip, city: c.city } : {}, lines,
      internalNotes: `Généré depuis la boutique « ${s.title} » : ${orders.map(o => o.number).join(", ")}. Encaissé en ligne : ${fmtEUR(orders.filter(o => o.payment.status === "paid").reduce((x, o) => x + o.total, 0))} TTC.` });
    const ids = new Set(orders.map(o => o.id));
    db.update("shopOrders", l => l.forEach(o => { if (ids.has(o.id)) { o.exportedAt = Date.now(); o.quoteId = q.id; } }));
    res.json({ id: q.id, orders: orders.length });
  }));

  /* ================= PUBLIC (membres) ================= */
  const findShop = t => db.get("shops").find(s => s.token === t && typeof t === "string" && t.length > 10);
  const publicShop = (s, req) => {
    const co = db.get("settings").company;
    return { title: s.title, intro: s.intro, deadline: s.deadline, payment: s.payment, open: s.status === "open" && !(s.deadline && Date.now() > s.deadline + 864e5),
      onlineAvailable: !!process.env.STRIPE_SECRET_KEY && s.payment !== "onsite",
      company: { name: co.name, logo: co.logo, email: co.email, phone: co.phone },
      products: s.products.map(({ line, ...p }) => p), link: shopLink(s, req) };
  };
  router.get("/public/shop/:token", (req, res) => {
    const s = findShop(req.params.token);
    s ? res.json(publicShop(s, req)) : res.status(404).json({ error: "Boutique introuvable." });
  });

  router.post("/public/shop/:token/order", wrap(async (req, res) => {
    const s = findShop(req.params.token);
    if (!s) return res.status(404).json({ error: "Boutique introuvable." });
    const pub = publicShop(s, req);
    if (!pub.open) throw new Error("Cette boutique est fermée.");
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const name = clean(b.name, 120).trim(), email = normEmail(b.email);
    if (!name || !EMAIL_RE.test(email)) throw new Error("Indiquez votre nom et un email valide.");
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map(i => {
      const p = s.products.find(x => x.id === i.productId);
      if (!p) return null;
      const qty = Math.max(0, Math.min(200, parseInt(i.qty, 10) || 0));
      const size = p.sizes.length ? (p.sizes.includes(i.size) ? i.size : null) : "Unique";
      if (!qty || !size) return null;
      const persoName = p.persoName ? clean(i.persoName, 30).trim() : "", persoNumber = p.persoNumber ? clean(i.persoNumber, 4).replace(/\D/g, "") : "";
      const unit = r2(p.price + ((persoName || persoNumber) ? p.persoPrice : 0));
      return { productId: p.id, name: p.name, size, color: p.colors.includes(i.color) ? i.color : p.colors[0] || "", qty, persoName, persoNumber, unit, total: r2(unit * qty) };
    }).filter(Boolean);
    if (!items.length) throw new Error("Votre panier est vide (choisissez une taille et une quantité).");
    const mode = s.payment === "online" ? "online" : s.payment === "onsite" ? "onsite" : (b.payMode === "online" ? "online" : "onsite");
    if (mode === "online" && !process.env.STRIPE_SECRET_KEY) throw new Error("Le paiement en ligne n'est pas disponible : choisissez le paiement auprès du club.");
    let number;
    db.update("shops", l => { const x = l.find(y => y.id === s.id); number = `${s.title.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")}-${String(x.nextOrder || 1).padStart(3, "0")}`; x.nextOrder = (x.nextOrder || 1) + 1; });
    const o = { id: uid("so"), shopId: s.id, number, createdAt: Date.now(), name, email, phone: clean(b.phone, 30), note: clean(b.note, 500),
      items, total: r2(items.reduce((x, i) => x + i.total, 0)), status: "ok", payment: { mode, status: "pending" } };
    db.update("shopOrders", l => l.push(o));
    if (mode === "online") {
      const back = `${shopLink(s, req)}&o=${o.id}`;
      const session = await ctx.stripe.checkout.sessions.create({
        mode: "payment", customer_email: email,
        line_items: items.map(i => ({ quantity: i.qty, price_data: { currency: "eur", unit_amount: Math.round(i.unit * 100), product_data: { name: `${i.name} — ${i.size}${i.persoName || i.persoNumber ? ` (${[i.persoName, i.persoNumber].filter(Boolean).join(" ")})` : ""}` } } })),
        success_url: `${back}&paid={CHECKOUT_SESSION_ID}`, cancel_url: back, metadata: { shopOrderId: o.id },
      });
      db.update("shopOrders", l => { const x = l.find(y => y.id === o.id); x.payment.sessionId = session.id; });
      return res.json({ ok: true, number, payUrl: session.url });
    }
    await mail.trySend({ to: email, subject: `Votre commande ${number} — ${s.title}`,
      text: `Bonjour ${name},\n\nMerci pour votre commande ${number} :\n${items.map(i => `- ${i.qty} × ${i.name} (${i.size}${i.persoName || i.persoNumber ? `, ${[i.persoName, i.persoNumber].filter(Boolean).join(" n°")}` : ""}) : ${fmtEUR(i.total)}`).join("\n")}\n\nTotal : ${fmtEUR(o.total)} TTC — à régler auprès de ${s.title}.\n\n${db.get("settings").company.name}` });
    res.json({ ok: true, number, total: o.total });
  }));

  router.post("/public/shop/:token/confirm", wrap(async (req, res) => {
    const s = findShop(req.params.token);
    const o = s && db.get("shopOrders").find(x => x.id === req.body?.orderId && x.shopId === s.id);
    if (!o) return res.status(404).json({ error: "Commande introuvable" });
    const session = await ctx.stripe.checkout.sessions.retrieve(clean(req.body.sessionId, 300));
    if (session.metadata?.shopOrderId !== o.id || session.payment_status !== "paid") throw new Error("Paiement non confirmé.");
    db.update("shopOrders", l => { const x = l.find(y => y.id === o.id); x.payment = { ...x.payment, status: "paid", at: Date.now() }; });
    res.json({ ok: true, number: o.number, total: o.total });
  }));
}

