/* Facturation : suivi des factures et connexion Pennylane (API externe v2).
   Les factures sont créées en BROUILLON par défaut : vous les vérifiez puis les finalisez dans Pennylane. */
import { uid, clean } from "./core.js";
import { r2, fmtEUR } from "../public/devis/pricing.js";

const SIGNED = ["accepte", "production", "expedie", "livre"];
const VAT_CODES = { 20: "FR_200", 10: "FR_100", 8.5: "FR_85", 5.5: "FR_55", 2.1: "FR_21", 0: "exempt" };
const iso = t => new Date(t).toISOString().slice(0, 10);
/** Prix unitaire au format attendu par Pennylane (2 décimales, 4 si nécessaire). */
const money = n => { const v = Math.round(n * 10000) / 10000; return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? v.toFixed(2) : v.toFixed(4); };

export function pennylaneRoutes(router, ctx) {
  const { db, requireAdmin, wrap } = ctx;
  const key = () => process.env.PENNYLANE_API_KEY || db.get("settings").pennylane.apiKey || "";
  const base = () => (process.env.PENNYLANE_API_URL || "https://app.pennylane.com/api/external/v2").replace(/\/$/, "");

  async function pl(method, path, body) {
    if (!key()) throw new Error("Pennylane n'est pas connecté (Paramètres > Intégrations).");
    const res = await fetch(base() + path, {
      method, headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const msg = data?.error || data?.message || (Array.isArray(data?.errors) ? data.errors.map(e => e.message || e).join(", ") : "") || data?.raw || "";
      throw new Error(`Pennylane ${res.status} : ${String(msg).slice(0, 300) || "erreur"}`);
    }
    return data;
  }

  router.post("/pennylane/test", requireAdmin, wrap(async (_req, res) => {
    let me = null;
    try { me = await pl("GET", "/me"); } catch (e) { if (/ 40[13] /.test(e.message)) throw e; await pl("GET", "/customer_invoices?limit=1"); }
    res.json({ ok: true, company: me?.company?.name || me?.user?.email || "" });
  }));

  /** Crée (une fois) le client dans Pennylane et mémorise son identifiant sur la fiche contact. */
  async function ensureCustomer(q) {
    let c = q.clientId ? db.get("clients").find(x => x.id === q.clientId) : null;
    if (!c) { c = ctx.ensureClient(q.client, { type: "client", source: "devis" }); q.clientId = c?.id || null; }
    if (!c) throw new Error("Renseignez le client du devis avant de facturer.");
    if (c.pennylaneId) return c.pennylaneId;
    const snap = { ...c, ...Object.fromEntries(Object.entries(q.client || {}).filter(([, v]) => v)) };
    const body = {
      name: snap.company || snap.contact || snap.email, emails: snap.email ? [snap.email] : [], phone: snap.phone || undefined,
      billing_address: { address: snap.address || "", postal_code: snap.zip || "", city: snap.city || "", country_alpha2: "FR" },
      vat_number: snap.vatNumber && /^[A-Z]{2}/i.test(snap.vatNumber) ? snap.vatNumber : undefined,
      reg_no: snap.siret || undefined, external_reference: c.id,
    };
    const created = await pl("POST", "/company_customers", body);
    const id = created.id ?? created.customer?.id;
    if (!id) throw new Error("Pennylane n'a pas renvoyé d'identifiant client.");
    db.update("clients", l => { const x = l.find(y => y.id === c.id); if (x) x.pennylaneId = id; });
    ctx.addActivity({ type: "system", clientId: c.id, text: "Client créé dans Pennylane" });
    return id;
  }

  /** Construit les lignes de facture à partir du calcul du devis. */
  function buildLines(q, kind) {
    const c = q.computed;
    const T = c.totals;
    const vat = VAT_CODES[T.vatRate] ?? "FR_200";
    const line = (label, quantity, unitHt, unit = "piece") => ({ label: clean(label, 250), quantity, raw_currency_unit_price: money(unitHt), unit, vat_rate: vat });
    const depositHt = r2(T.deposit / (1 + T.vatRate / 100));
    if (kind === "acompte") return [line(`Acompte ${T.depositPct} % — devis ${q.number}${q.title ? ` (${q.title})` : ""}`, 1, depositHt, "forfait")];
    const lines = [];
    for (const l of c.lines) {
      const marks = l.persos.map(p => `${p.techniqueName} ${p.position}`.trim()).join(", ");
      const sizes = l.sizeRows.map(r => `${r.size}×${r.qty}`).join(" ");
      lines.push(line(`${l.name}${l.color ? ` — ${l.color}` : ""}${marks ? ` — ${marks}` : ""}${sizes ? ` (${sizes})` : ""}`, l.qty || 1, l.qty ? l.total / l.qty : l.total));
    }
    for (const s of c.setups) lines.push(line(s.label, 1, s.amount, "forfait"));
    for (const f of c.fees) lines.push(line(f.label, f.qty || 1, f.unit, "forfait"));
    if (T.discount) lines.push(line(`Remise ${T.discountPct} %`, 1, -T.discount, "forfait"));
    if (T.shipping) lines.push(line("Frais de livraison", 1, T.shipping, "forfait"));
    if (kind === "solde") {
      const dep = (q.invoices || []).find(i => i.kind === "acompte");
      if (dep) lines.push(line(`Acompte déjà facturé${dep.number ? ` (facture ${dep.number})` : ""}`, 1, -(dep.amountHt ?? depositHt), "forfait"));
    }
    return lines;
  }

  router.get("/billing", requireAdmin, (_req, res) => {
    res.json(db.get("quotes").filter(q => SIGNED.includes(q.status) || (q.invoices || []).length).map(ctx.quoteSummary).sort((a, b) => b.updatedAt - a.updatedAt));
  });

  router.post("/quotes/:id/invoice", requireAdmin, wrap(async (req, res) => {
    const kind = ["acompte", "solde", "total"].includes(req.body?.kind) ? req.body.kind : "total";
    const q = db.get("quotes").find(x => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    if ((q.invoices || []).some(i => i.kind === kind && i.status !== "annulee")) throw new Error(`Une facture « ${kind} » existe déjà pour ce devis.`);
    if (kind === "acompte" && !(q.computed?.totals?.deposit > 0)) throw new Error("Aucun acompte prévu sur ce devis.");
    const s = db.get("settings");
    const customerId = await ensureCustomer(q);
    const lines = buildLines(q, kind);
    const ht = r2(lines.reduce((x, l) => x + Number(l.raw_currency_unit_price) * l.quantity, 0));
    const body = {
      customer_id: customerId, date: iso(Date.now()), deadline: iso(Date.now() + (s.paymentTermsDays || 30) * 864e5),
      draft: s.pennylane.draft !== false, label: `${kind === "acompte" ? "Acompte" : kind === "solde" ? "Solde" : "Facture"} — devis ${q.number}`,
      external_reference: `${q.number}-${kind}`, invoice_lines: lines,
    };
    const inv = await pl("POST", "/customer_invoices", body);
    const rec = {
      id: uid("i"), kind, provider: "pennylane", pennylaneId: inv.id, number: inv.invoice_number || inv.label || "", status: inv.status || (body.draft ? "draft" : "upcoming"),
      paid: !!inv.paid, amountHt: ht, amountTtc: Number(inv.amount ?? inv.currency_amount ?? r2(ht * (1 + q.computed.totals.vatRate / 100))), url: inv.public_file_url || inv.file_url || "", at: Date.now(),
    };
    db.update("quotes", qs => {
      const x = qs.find(y => y.id === q.id);
      (x.invoices ||= []).push(rec);
      x.clientId ||= q.clientId;
      ctx.logQuote(x, "invoice", `Facture ${kind} créée dans Pennylane${body.draft ? " (brouillon)" : ""} — ${fmtEUR(ht)} HT`);
    });
    ctx.addActivity({ type: "system", clientId: q.clientId, quoteId: q.id, text: `Facture ${kind} ${rec.number} créée dans Pennylane (${fmtEUR(ht)} HT)` });
    res.json(rec);
  }));

  // Saisie manuelle (si vous facturez ailleurs)
  router.post("/quotes/:id/invoice/manual", requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const rec = { id: uid("i"), kind: ["acompte", "solde", "total"].includes(b.kind) ? b.kind : "total", provider: "manuel", number: clean(b.number, 60),
      amountTtc: Number(b.amountTtc) || 0, amountHt: Number(b.amountHt) || 0, paid: !!b.paid, status: b.paid ? "paid" : "upcoming", at: Date.now(), url: "" };
    const ok = db.update("quotes", qs => {
      const x = qs.find(y => y.id === req.params.id);
      if (!x) return false;
      (x.invoices ||= []).push(rec);
      ctx.logQuote(x, "invoice", `Facture ${rec.kind} ${rec.number} enregistrée`);
      return true;
    });
    ok ? res.json(rec) : res.status(404).json({ error: "Devis introuvable" });
  }));

  router.patch("/quotes/:id/invoices/:invId", requireAdmin, wrap((req, res) => {
    const rec = db.update("quotes", qs => {
      const x = qs.find(y => y.id === req.params.id);
      const i = x?.invoices?.find(y => y.id === req.params.invId);
      if (!i) return null;
      if ("paid" in req.body) { i.paid = !!req.body.paid; i.status = i.paid ? "paid" : "upcoming"; }
      if (req.body.status === "annulee") i.status = "annulee";
      if ("number" in req.body) i.number = clean(req.body.number, 60);
      return i;
    });
    rec ? res.json(rec) : res.status(404).json({ error: "Facture introuvable" });
  }));

  /** Interroge Pennylane pour les factures du devis (réseau, sans rien écrire). */
  async function fetchRemote(q) {
    const out = {};
    for (const i of (q.invoices || []).filter(x => x.provider === "pennylane" && x.pennylaneId)) {
      const inv = await pl("GET", `/customer_invoices/${i.pennylaneId}`);
      out[i.id] = { number: inv.invoice_number || i.number, status: inv.status || i.status, paid: !!(inv.paid || inv.status === "paid"), url: inv.public_file_url || inv.file_url || i.url };
    }
    return out;
  }
  /** Applique les données Pennylane au devis ; solde le devis quand tout est payé. Synchrone. */
  function applyRemote(q, remote) {
    let changed = 0;
    for (const i of q.invoices || []) {
      const next = remote[i.id];
      if (next && JSON.stringify(next) !== JSON.stringify({ number: i.number, status: i.status, paid: i.paid, url: i.url })) { Object.assign(i, next); changed++; }
    }
    const live = (q.invoices || []).filter(i => i.status !== "annulee");
    if (live.length && live.every(i => i.paid) && live.some(i => i.kind !== "acompte") && q.payment?.status !== "paye") {
      q.payment = { status: "paye", at: Date.now(), note: "Pennylane" };
      ctx.logQuote(q, "payment", "Commande soldée (paiement constaté dans Pennylane)");
      changed++;
    } else if (live.some(i => i.kind === "acompte" && i.paid) && (!q.payment || q.payment.status === "non_paye")) {
      q.payment = { status: "acompte", at: Date.now(), note: "Pennylane" };
      ctx.completeTasks(`quote:${q.id}:deposit`);
      changed++;
    }
    return changed;
  }
  async function syncQuote(id) {
    const q = db.get("quotes").find(x => x.id === id);
    if (!q) return { changed: 0, q: null };
    const remote = await fetchRemote(q);
    return db.update("quotes", qs => { const x = qs.find(y => y.id === id); return x ? { changed: applyRemote(x, remote), q: x } : { changed: 0, q: null }; });
  }
  ctx.pennylaneSync = async () => {
    if (!key()) return 0;
    let n = 0;
    for (const q of db.get("quotes").filter(x => (x.invoices || []).some(i => i.provider === "pennylane" && !i.paid))) {
      try { n += (await syncQuote(q.id)).changed; } catch (e) { console.error("Synchro Pennylane :", e.message); }
    }
    return n;
  };

  router.post("/quotes/:id/invoice/sync", requireAdmin, wrap(async (req, res) => {
    const { changed, q } = await syncQuote(req.params.id);
    if (!q) return res.status(404).json({ error: "Devis introuvable" });
    res.json({ changed, invoices: q.invoices, payment: q.payment });
  }));
  router.post("/pennylane/sync", requireAdmin, wrap(async (_req, res) => res.json({ changed: await ctx.pennylaneSync() })));
}
