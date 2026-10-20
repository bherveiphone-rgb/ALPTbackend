/* Qonto (lecture seule) : relève les virements reçus et les rapproche des devis
   (référence DEV-AAAA-NNNN dans le libellé, sinon montant + nom du client). */
import { uid, clean, DAY } from "./core.js";
import { fmtEUR, r2 } from "../public/devis/pricing.js";

const SIGNED = ["accepte", "production", "expedie", "livre"];
const NUM_RE = /[A-Z]{2,5}-\d{4}-\d{4}/;
const norm = s => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function qontoRoutes(router, ctx) {
  const { db, requireAdmin, wrap } = ctx;
  const cfg = () => {
    const q = db.get("settings").qonto || {};
    return { login: process.env.QONTO_LOGIN || q.login || "", key: process.env.QONTO_SECRET_KEY || q.secretKey || "" };
  };
  const base = () => (process.env.QONTO_API_URL || "https://thirdparty.qonto.com/v2").replace(/\/$/, "");
  ctx.qontoEnabled = () => { const c = cfg(); return !!(c.login && c.key); };

  async function qf(path) {
    const c = cfg();
    if (!c.login || !c.key) throw new Error("Qonto n'est pas connecté (Paramètres > Banque).");
    const r = await fetch(base() + path, { headers: { Authorization: `${c.login}:${c.key}`, Accept: "application/json" } });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 300) }; }
    if (!r.ok) throw new Error(`Qonto ${r.status} : ${d?.errors?.[0]?.detail || d?.message || d?.raw || "erreur"}`);
    return d;
  }

  router.post("/qonto/test", requireAdmin, wrap(async (_req, res) => {
    const d = await qf("/organization");
    const o = d.organization || d;
    res.json({ ok: true, name: o.legal_name || o.name || o.slug || "", accounts: (o.bank_accounts || []).map(a => ({ name: a.name, iban: a.iban })) });
  }));

  /* -------- Montants attendus d'un devis selon son état de paiement -------- */
  function expectations(q) {
    const T = q.computed?.totals || {};
    const depositPaid = !!q.depositPayment?.paid || q.payment?.status === "acompte";
    const out = [];
    if (!depositPaid && T.deposit > 0) out.push({ kind: "acompte", amount: r2(T.deposit) });
    out.push({ kind: "paye", amount: r2(depositPaid ? T.ttc - (q.depositPayment?.amount ?? T.deposit) : T.ttc) });
    return out;
  }
  const near = (a, b) => Math.abs(a - b) < 0.011;

  /** Trouve le devis correspondant à un virement. Renvoie { quoteId, kind, status: auto|suggested|unmatched, candidates }. */
  function match(tx, quotes, clients) {
    const text = norm(`${tx.label} ${tx.reference} ${tx.note}`);
    const open = quotes.filter(q => SIGNED.includes(q.status) && q.payment?.status !== "paye");
    const num = text.match(NUM_RE)?.[0];
    if (num) {
      const q = quotes.find(x => x.number === num);
      if (q) {
        const exp = expectations(q);
        const hit = exp.find(e => near(e.amount, tx.amount));
        return { quoteId: q.id, kind: hit?.kind || (tx.amount >= (q.computed?.totals?.ttc || 0) - 0.01 ? "paye" : "acompte"), status: "auto", reason: `référence ${num}` };
      }
    }
    const cands = [];
    for (const q of open) for (const e of expectations(q)) if (near(e.amount, tx.amount)) cands.push({ quoteId: q.id, kind: e.kind });
    if (!cands.length) return { status: "unmatched", candidates: [] };
    const nameHit = c => {
      const q = quotes.find(x => x.id === c.quoteId);
      const cl = clients.find(x => x.id === q.clientId);
      return [q.client?.company, q.client?.contact, cl?.company].filter(Boolean).some(n => norm(n).split(/\s+/).filter(w => w.length > 3).some(w => text.includes(w)));
    };
    const named = cands.filter(nameHit);
    if (cands.length === 1 && named.length === 1) return { ...cands[0], status: "auto", reason: "montant et nom du client" };
    if (named.length === 1) return { ...named[0], status: "suggested", candidates: cands, reason: "montant et nom du client (plusieurs montants identiques)" };
    return { ...(cands.length === 1 ? cands[0] : {}), status: "suggested", candidates: cands, reason: cands.length === 1 ? "même montant" : `${cands.length} devis du même montant` };
  }

  /** Enregistre le paiement sur le devis (commun Qonto / confirmation manuelle). */
  function applyPayment(quoteId, kind, amount, source) {
    let done = null;
    db.update("quotes", qs => {
      const q = qs.find(x => x.id === quoteId);
      if (!q) return;
      if (kind === "acompte") {
        q.depositPayment = { paid: true, at: Date.now(), amount, source };
        if (!q.payment || q.payment.status === "non_paye") q.payment = { status: "acompte", at: Date.now(), note: source };
      } else q.payment = { status: "paye", at: Date.now(), note: source, amount };
      q.attention = true; q.updatedAt = Date.now();
      ctx.logQuote(q, "payment", `${kind === "acompte" ? "Acompte" : "Paiement"} de ${fmtEUR(amount)} reçu (${source})`);
      done = q;
    });
    if (done) {
      ctx.completeTasks(`quote:${quoteId}:deposit`);
      ctx.addActivity({ type: "system", clientId: done.clientId, quoteId, text: `Virement de ${fmtEUR(amount)} reçu — ${done.number}` });
    }
    return done;
  }
  ctx.applyPayment = applyPayment;

  /** Relève les crédits depuis la dernière synchro et les rapproche. */
  ctx.qontoSync = async () => {
    if (!ctx.qontoEnabled()) return { new: 0 };
    const st = db.get("bankstate");
    const from = new Date(st.lastSettled || Date.now() - 30 * DAY).toISOString();
    const org = await qf("/organization");
    const accounts = (org.organization || org).bank_accounts || [];
    const known = new Set(db.get("bankmatches").map(m => m.txId));
    let quotes = db.get("quotes");
    const clients = db.get("clients");
    let latest = st.lastSettled || 0, added = 0, auto = 0;
    for (const acc of accounts) {
      for (let page = 1; page <= 20; page++) {
        const qs = new URLSearchParams({ iban: acc.iban, side: "credit", settled_at_from: from, per_page: "100", current_page: String(page) });
        const d = await qf(`/transactions?status[]=completed&${qs}`);
        for (const t of d.transactions || []) {
          const txId = t.transaction_id || t.id;
          if (!txId || known.has(txId) || (t.side && t.side !== "credit")) continue;
          const amount = r2(t.amount ?? (t.amount_cents ?? 0) / 100);
          const tx = { txId, amount, label: clean(t.label, 200), reference: clean(t.reference, 200), note: clean(t.note, 200),
            date: Date.parse(t.settled_at || t.emitted_at) || Date.now(), account: acc.name || acc.iban };
          latest = Math.max(latest, tx.date);
          const m = match(tx, quotes, clients);
          const rec = { id: uid("bk"), ...tx, ...m, createdAt: Date.now() };
          if (m.status === "auto") { applyPayment(m.quoteId, m.kind, amount, "virement Qonto"); auto++; quotes = db.get("quotes"); }
          db.update("bankmatches", l => { l.push(rec); if (l.length > 1000) l.splice(0, l.length - 1000); });
          known.add(txId); added++;
        }
        if (!d.meta?.next_page) break;
      }
    }
    db.set("bankstate", { ...st, lastSettled: latest, lastSync: Date.now(), lastError: null });
    if (auto) ctx.notifyAdmin(`💶 ${auto} virement(s) rapproché(s) automatiquement`, "Voir Facturation > Virements.", "/facturation");
    return { new: added, auto };
  };

  router.post("/qonto/sync", requireAdmin, wrap(async (_req, res) => {
    try { res.json(await ctx.qontoSync()); }
    catch (e) { db.set("bankstate", { ...db.get("bankstate"), lastError: e.message, lastSync: Date.now() }); throw e; }
  }));
  router.get("/bank/matches", requireAdmin, (_req, res) => {
    const quotes = db.get("quotes");
    const num = id => quotes.find(q => q.id === id)?.number || "";
    res.json({ state: db.get("bankstate"), enabled: ctx.qontoEnabled(),
      matches: db.get("bankmatches").slice(-300).reverse().map(m => ({ ...m, number: num(m.quoteId), candidates: (m.candidates || []).map(c => ({ ...c, number: num(c.quoteId) })) })) });
  });
  router.post("/bank/matches/:id/:action(confirm|ignore)", requireAdmin, wrap((req, res) => {
    const m = db.get("bankmatches").find(x => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: "Opération introuvable" });
    if (req.params.action === "confirm") {
      const quoteId = req.body?.quoteId || m.quoteId, kind = req.body?.kind || m.kind || "paye";
      if (!applyPayment(quoteId, kind, m.amount, "virement Qonto (confirmé)")) throw new Error("Devis introuvable");
      db.update("bankmatches", l => { const x = l.find(y => y.id === m.id); Object.assign(x, { status: "confirmed", quoteId, kind }); });
    } else db.update("bankmatches", l => { const x = l.find(y => y.id === m.id); x.status = "ignored"; });
    res.json({ ok: true });
  }));
}
