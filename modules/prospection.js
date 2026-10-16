/* Prospection : base de prospects, recherche dans l'annuaire officiel des entreprises,
   campagnes d'emails en plusieurs étapes envoyées depuis votre boîte mail (avec désinscription). */
import { uid, token, clean, normEmail, DAY } from "./core.js";

const STATUSES = ["nouveau", "en_sequence", "repondu", "interesse", "converti", "sans_reponse", "non_interesse", "desinscrit", "invalide"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const FIELDS = ["company", "contact", "firstName", "role", "email", "phone", "website", "address", "zip", "city", "sector", "naf", "siren", "notes", "source"];

// Codes d'activité (NAF) utiles pour un atelier de textile personnalisé
export const NAF_PRESETS = [
  ["93.12Z", "Clubs de sports"], ["93.11Z", "Gestion d'installations sportives"], ["93.13Z", "Salles de sport / fitness"],
  ["93.19Z", "Autres activités liées au sport"], ["94.99Z", "Associations (autres organisations)"], ["85.51Z", "Enseignement sportif et de loisirs"],
  ["85.31Z", "Collèges et lycées"], ["85.42Z", "Enseignement supérieur (BDE, écoles)"], ["84.11Z", "Mairies / administrations"],
  ["82.30Z", "Organisation de salons et événements"], ["56.10A", "Restaurants (tenues de service)"], ["56.30Z", "Bars et cafés"],
  ["43.21A", "Électriciens (vêtements de travail)"], ["43.22A", "Plombiers / chauffagistes"], ["41.20A", "Construction (BTP)"],
  ["81.30Z", "Paysagistes"], ["96.02A", "Coiffure"], ["49.32Z", "Taxis / VTC"], ["79.11Z", "Agences de voyage"], ["70.21Z", "Communication / RP"],
];

const firstWord = s => String(s || "").trim().split(/\s+/)[0] || "";
function score(p, optout) {
  if (optout.has(normEmail(p.email))) return 0;
  let s = 0;
  if (EMAIL_RE.test(p.email || "")) s += 35;
  if (p.firstName || p.contact) s += 15;
  if (p.phone) s += 10;
  if (p.website) s += 5;
  if (p.naf && NAF_PRESETS.slice(0, 8).some(([c]) => c === p.naf)) s += 15;
  if (/club|asso|sport|ecole|école|bde|comit/i.test(p.company || "")) s += 10;
  if (["repondu", "interesse"].includes(p.status)) s += 10;
  return Math.min(100, s);
}

export function prospectionRoutes(router, ctx) {
  const { db, mail, requireAdmin, wrap } = ctx;
  const optoutSet = () => new Set(db.get("optout").map(o => o.email));
  const clean1 = b => Object.fromEntries(FIELDS.filter(k => k in b).map(k => [k, k === "email" ? normEmail(b[k]) : clean(b[k], k === "notes" ? 3000 : 300)]));

  /* ================= PROSPECTS ================= */
  router.get("/prospects", requireAdmin, (_req, res) => {
    const opt = optoutSet();
    res.json(db.get("prospects").map(p => ({ ...p, score: score(p, opt), optedOut: opt.has(normEmail(p.email)) })));
  });

  router.post("/prospects", requireAdmin, wrap((req, res) => {
    const d = clean1(req.body || {});
    if (!d.company && !d.email) throw new Error("Indiquez au moins une structure ou un email.");
    if (d.email && db.get("prospects").some(p => normEmail(p.email) === d.email)) throw new Error("Ce prospect existe déjà.");
    const p = { id: uid("p"), createdAt: Date.now(), status: "nouveau", tags: Array.isArray(req.body.tags) ? req.body.tags : [], token: token(), step: 0, sentCount: 0, source: "manuel", ...d };
    db.update("prospects", l => l.push(p));
    res.json(p);
  }));

  router.put("/prospects/:id", requireAdmin, wrap((req, res) => {
    const p = db.update("prospects", l => {
      const x = l.find(y => y.id === req.params.id);
      if (!x) return null;
      Object.assign(x, clean1(req.body || {}));
      if (Array.isArray(req.body.tags)) x.tags = req.body.tags.map(t => clean(t, 40)).slice(0, 20);
      if (req.body.status && STATUSES.includes(req.body.status)) {
        x.status = req.body.status;
        if (x.status !== "en_sequence") x.nextAt = null;
      }
      x.updatedAt = Date.now();
      return x;
    });
    if (!p) return res.status(404).json({ error: "Prospect introuvable" });
    res.json(p);
  }));

  router.delete("/prospects/:id", requireAdmin, (req, res) => { db.set("prospects", db.get("prospects").filter(p => p.id !== req.params.id)); res.json({ ok: true }); });

  /**
   * Import de prospects (CSV de l'interface, ou envoi automatisé par script / par Claude).
   * Corps : { items: [{company, contact, email, phone, city, zip, sector, naf, siren, website, notes}], tags: [], source: "" }
   * Dédoublonnage par email puis par SIREN ; les adresses désinscrites sont ignorées.
   */
  router.post("/prospects/import", requireAdmin, wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20000) : [];
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(t => clean(t, 40)) : [];
    const source = clean(req.body?.source, 100) || "import";
    const opt = optoutSet();
    const clientEmails = new Set(db.get("clients").map(c => normEmail(c.email)).filter(Boolean));
    let added = 0, updated = 0, skipped = 0;
    db.update("prospects", list => {
      for (const raw of items) {
        const d = clean1(raw);
        if (!d.company && !d.email) { skipped++; continue; }
        if (d.email && (opt.has(d.email) || clientEmails.has(d.email))) { skipped++; continue; }
        if (d.email && !EMAIL_RE.test(d.email)) d.email = "";
        if (!d.firstName && d.contact) d.firstName = firstWord(d.contact);
        const ex = list.find(p => (d.email && normEmail(p.email) === d.email) || (d.siren && p.siren === d.siren));
        if (ex) {
          for (const [k, v] of Object.entries(d)) if (v && !ex[k]) ex[k] = v;
          ex.tags = [...new Set([...(ex.tags || []), ...tags])];
          updated++;
        } else {
          list.push({ id: uid("p"), createdAt: Date.now(), status: "nouveau", tags: [...tags], token: token(), step: 0, sentCount: 0, ...d, source: d.source || source });
          added++;
        }
      }
    });
    res.json({ added, updated, skipped });
  }));

  router.post("/prospects/bulk", requireAdmin, wrap((req, res) => {
    const { ids = [], action, sequenceId, status, tag } = req.body || {};
    const set = new Set(ids);
    const opt = optoutSet();
    let n = 0;
    if (action === "delete") {
      db.set("prospects", db.get("prospects").filter(p => { if (set.has(p.id)) { n++; return false; } return true; }));
      return res.json({ count: n });
    }
    const seq = db.get("sequences").find(s => s.id === sequenceId);
    if (action === "enroll" && !seq) throw new Error("Choisissez une campagne.");
    db.update("prospects", list => {
      for (const p of list.filter(x => set.has(x.id))) {
        if (action === "enroll") {
          if (!EMAIL_RE.test(p.email || "") || opt.has(normEmail(p.email)) || ["converti", "desinscrit", "invalide", "repondu", "interesse"].includes(p.status)) continue;
          Object.assign(p, { sequenceId: seq.id, step: 0, status: "en_sequence", nextAt: Date.now(), enrolledAt: Date.now() });
        } else if (action === "stop") {
          if (p.status !== "en_sequence") continue;
          Object.assign(p, { status: "nouveau", nextAt: null });
        } else if (action === "status" && STATUSES.includes(status)) {
          p.status = status; if (status !== "en_sequence") p.nextAt = null;
        } else if (action === "tag" && tag) {
          p.tags = [...new Set([...(p.tags || []), clean(tag, 40)])];
        } else continue;
        n++;
      }
    });
    res.json({ count: n });
  }));

  // Prospect → fiche contact du CRM (et éventuellement nouvelle demande)
  router.post("/prospects/:id/convert", requireAdmin, wrap((req, res) => {
    const p = db.get("prospects").find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Prospect introuvable" });
    const c = ctx.ensureClient({ company: p.company, contact: p.contact, email: p.email, phone: p.phone, address: p.address, zip: p.zip, city: p.city }, { type: "prospect", source: `prospection${p.source ? ` (${p.source})` : ""}`, tags: p.tags || [] });
    db.update("clients", l => { const x = l.find(y => y.id === c.id); if (x) { x.siret ||= p.siren || ""; x.website ||= p.website || ""; x.sector ||= p.sector || ""; } });
    db.update("prospects", l => { const x = l.find(y => y.id === p.id); x.status = "converti"; x.clientId = c.id; x.nextAt = null; });
    db.update("activities", l => l.forEach(a => { if (a.prospectId === p.id && !a.clientId) a.clientId = c.id; }));
    ctx.addActivity({ type: "system", clientId: c.id, prospectId: p.id, text: "Prospect converti en contact" });
    res.json({ clientId: c.id });
  }));

  /* -------- Recherche dans l'annuaire officiel (recherche-entreprises.api.gouv.fr, gratuit) -------- */
  router.get("/prospects/search-companies", requireAdmin, wrap(async (req, res) => {
    const params = new URLSearchParams({ per_page: "25", page: String(Math.max(1, parseInt(req.query.page, 10) || 1)) });
    if (req.query.q) params.set("q", clean(req.query.q, 100));
    if (req.query.naf) params.set("activite_principale", clean(req.query.naf, 200));
    if (req.query.departement) params.set("departement", clean(req.query.departement, 100));
    if (req.query.code_postal) params.set("code_postal", clean(req.query.code_postal, 100));
    if (!params.has("q") && !params.has("activite_principale")) throw new Error("Indiquez un mot-clé ou une activité.");
    params.set("etat_administratif", "A");
    const url = (process.env.ENTREPRISES_API_URL || "https://recherche-entreprises.api.gouv.fr") + "/search?" + params;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Annuaire des entreprises indisponible (${r.status}).`);
    const data = await r.json();
    const known = new Set(db.get("prospects").map(p => p.siren).filter(Boolean));
    const results = (data.results || []).map(e => {
      const siege = e.siege || {};
      const dir = (e.dirigeants || []).find(d => d.type_dirigeant === "personne physique" || d.nom) || {};
      const contact = [dir.prenoms ? firstWord(dir.prenoms) : "", dir.nom ? dir.nom.charAt(0) + dir.nom.slice(1).toLowerCase() : ""].filter(Boolean).join(" ");
      return {
        siren: e.siren, company: e.nom_complet || e.nom_raison_sociale || "", naf: siege.activite_principale || e.activite_principale || "",
        address: siege.adresse || siege.geo_adresse || "", zip: siege.code_postal || "", city: siege.libelle_commune || "",
        contact, firstName: dir.prenoms ? firstWord(dir.prenoms) : "", role: dir.qualite || "",
        employees: e.tranche_effectif_salarie || "", created: e.date_creation || "", known: known.has(e.siren),
      };
    });
    res.json({ results, total: data.total_results || results.length, page: data.page || 1, totalPages: data.total_pages || 1 });
  }));

  /* ================= CAMPAGNES (séquences) ================= */
  const seqStats = (s, prospects) => {
    const ps = prospects.filter(p => p.sequenceId === s.id);
    return {
      enrolled: ps.length, active: ps.filter(p => p.status === "en_sequence").length, sent: ps.reduce((x, p) => x + (p.sentCount || 0), 0),
      replied: ps.filter(p => ["repondu", "interesse", "converti"].includes(p.status)).length, converted: ps.filter(p => p.status === "converti").length,
      unsubscribed: ps.filter(p => p.status === "desinscrit").length,
    };
  };
  router.get("/sequences", requireAdmin, (_req, res) => {
    const prospects = db.get("prospects");
    res.json(db.get("sequences").map(s => ({ ...s, stats: seqStats(s, prospects) })));
  });
  const cleanSeq = b => ({
    name: clean(b.name, 120) || "Campagne", active: !!b.active,
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 8).map(st => ({ delayDays: Math.max(0, Math.min(90, Number(st.delayDays) || 0)), subject: clean(st.subject, 250), body: clean(st.body, 10000) })).filter(st => st.subject && st.body),
  });
  router.post("/sequences", requireAdmin, wrap((req, res) => {
    const s = { id: uid("s"), createdAt: Date.now(), ...cleanSeq(req.body || {}) };
    if (!s.steps.length) throw new Error("Ajoutez au moins une étape avec un objet et un message.");
    db.update("sequences", l => l.push(s));
    res.json(s);
  }));
  router.put("/sequences/:id", requireAdmin, wrap((req, res) => {
    const s = db.update("sequences", l => { const x = l.find(y => y.id === req.params.id); if (!x) return null; Object.assign(x, cleanSeq({ ...x, ...req.body })); return x; });
    s ? res.json(s) : res.status(404).json({ error: "Campagne introuvable" });
  }));
  router.delete("/sequences/:id", requireAdmin, (req, res) => {
    db.set("sequences", db.get("sequences").filter(s => s.id !== req.params.id));
    db.update("prospects", l => l.forEach(p => { if (p.sequenceId === req.params.id && p.status === "en_sequence") { p.status = "nouveau"; p.nextAt = null; } }));
    res.json({ ok: true });
  });

  /* -------- Rendu d'un email de campagne -------- */
  function renderStep(seq, stepIdx, p, req) {
    const s = db.get("settings");
    const base = ctx.baseUrl(req);
    const unsub = `${base}/api/devis/public/unsubscribe/${p.token}`;
    const vars = {
      prenom: p.firstName || firstWord(p.contact), contact: p.contact || "", societe: p.company || "votre structure", ville: p.city || "",
      atelier: s.company.name, atelier_contact: s.company.contactName || s.company.name, signature: s.emailSignature || s.company.name,
      lien_demande: `${base}/devis/demande.html?src=prospection&ref=${p.token}`, desinscription: unsub, site: s.company.website || "",
    };
    const st = seq.steps[stepIdx];
    const fix = t => t.replace(/Bonjour\s+,/g, "Bonjour,").replace(/[ \t]+\n/g, "\n");
    const footer = mail.render(s.prospection.footer || "", vars);
    return { subject: fix(mail.render(st.subject, vars)), text: `${fix(mail.render(st.body, vars))}\n\n--\n${footer}`, unsub };
  }
  router.post("/sequences/:id/preview", requireAdmin, wrap((req, res) => {
    const seq = db.get("sequences").find(s => s.id === req.params.id) || cleanSeq(req.body || {});
    const p = db.get("prospects").find(x => x.id === req.body?.prospectId) || { company: "Club Exemple", contact: "Camille Martin", firstName: "Camille", city: "Lyon", token: "exemple" };
    res.json(seq.steps.map((_, i) => renderStep(seq, i, p, req)));
  }));
  router.post("/sequences/:id/test", requireAdmin, wrap(async (req, res) => {
    const seq = db.get("sequences").find(s => s.id === req.params.id);
    if (!seq) return res.status(404).json({ error: "Campagne introuvable" });
    const to = normEmail(req.body?.to);
    if (!EMAIL_RE.test(to)) throw new Error("Email de test invalide");
    const p = { company: "Club Exemple", contact: "Camille Martin", firstName: "Camille", city: "Lyon", token: "test" };
    const step = Math.max(0, Math.min(seq.steps.length - 1, parseInt(req.body?.step, 10) || 0));
    const m = renderStep(seq, step, p, req);
    await mail.send({ to, subject: `[TEST] ${m.subject}`, text: m.text });
    res.json({ ok: true });
  }));

  /* -------- Désinscription -------- */
  router.get("/optout", requireAdmin, (_req, res) => res.json(db.get("optout").slice().reverse()));
  router.post("/optout", requireAdmin, wrap((req, res) => {
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) throw new Error("Email invalide");
    unsubscribe(email, "ajout manuel");
    res.json({ ok: true });
  }));
  router.delete("/optout/:email", requireAdmin, (req, res) => { db.set("optout", db.get("optout").filter(o => o.email !== normEmail(req.params.email))); res.json({ ok: true }); });
  function unsubscribe(email, reason) {
    db.update("optout", l => { if (!l.some(o => o.email === email)) l.push({ email, at: Date.now(), reason }); });
    db.update("prospects", l => l.forEach(p => { if (normEmail(p.email) === email) { p.status = "desinscrit"; p.nextAt = null; } }));
  }
  const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;background:#f4f5f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;color:#161a2b}.c{background:#fff;border-radius:14px;padding:32px;max-width:440px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}button{background:#4f46e5;color:#fff;border:0;border-radius:9px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer}</style></head><body><div class="c">${body}</div></body></html>`;
  router.get("/public/unsubscribe/:token", (req, res) => {
    const p = db.get("prospects").find(x => x.token === req.params.token);
    if (!p) return res.status(404).send(page("Lien invalide", "<h2>Lien invalide</h2><p>Ce lien de désinscription n'est pas reconnu.</p>"));
    const done = p.status === "desinscrit";
    res.send(page("Désinscription", done ? "<h2>C'est fait ✅</h2><p>Vous ne recevrez plus nos messages.</p>"
      : `<h2>Se désinscrire</h2><p>Vous ne recevrez plus aucun message de prospection de notre part.</p><form method="post"><button>Confirmer la désinscription</button></form>`));
  });
  // POST : bouton de la page ou « désinscription en un clic » des messageries (RFC 8058)
  router.post("/public/unsubscribe/:token", (req, res) => {
    const p = db.get("prospects").find(x => x.token === req.params.token);
    if (p?.email) {
      unsubscribe(normEmail(p.email), "lien de désinscription");
      ctx.addActivity({ type: "system", prospectId: p.id, clientId: p.clientId || null, text: `${p.email} s'est désinscrit de la prospection` });
    }
    res.send(page("Désinscription", "<h2>C'est fait ✅</h2><p>Vous ne recevrez plus nos messages. Désolé pour le dérangement.</p>"));
  });

  /* ================= ENVOI PROGRESSIF ================= */
  const parisNow = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { hour: Number(parts.hour), weekend: /sam|dim/i.test(parts.weekday), day: `${parts.year}-${parts.month}-${parts.day}` };
  };
  /** Envoie au plus un email de campagne par appel, en respectant la fenêtre horaire, le quota et l'espacement. */
  ctx.prospectionTick = async (force = false) => {
    if (!mail.configured()) return null;
    const s = db.get("settings").prospection;
    const now = Date.now();
    const t = parisNow();
    if (!force && (t.hour < s.startHour || t.hour >= s.endHour || (s.weekdaysOnly && t.weekend))) return null;
    const st = db.get("prospstate");
    const count = st.day === t.day ? st.count || 0 : 0;
    if (count >= s.dailyLimit) return null;
    if (!force && st.lastAt && now - st.lastAt < s.minGapMinutes * 60_000) return null;
    const seqs = Object.fromEntries(db.get("sequences").filter(x => x.active).map(x => [x.id, x]));
    const opt = optoutSet();
    const prospects = db.get("prospects");
    const p = prospects.filter(x => x.status === "en_sequence" && seqs[x.sequenceId] && x.nextAt && x.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt)[0];
    if (!p) return null;
    const seq = seqs[p.sequenceId];
    if (opt.has(normEmail(p.email))) { p.status = "desinscrit"; p.nextAt = null; db.set("prospects", prospects); return null; }
    if (p.step >= seq.steps.length) { p.status = "sans_reponse"; p.nextAt = null; db.set("prospects", prospects); return null; }
    const m = renderStep(seq, p.step, p);
    db.set("prospstate", { day: t.day, count: count + 1, lastAt: now });
    try {
      const headers = { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
      if (p.lastMessageId) { headers["In-Reply-To"] = p.lastMessageId; headers.References = p.lastMessageId; }
      const r = await mail.send({ to: p.email, subject: m.subject, text: m.text, headers });
      p.lastMessageId = r.messageId;
      p.sentCount = (p.sentCount || 0) + 1; p.lastSentAt = now; p.step++;
      p.nextAt = p.step < seq.steps.length ? now + seq.steps[p.step].delayDays * DAY : null;
      if (!p.nextAt) { p.status = "sans_reponse"; p.finishedAt = now; }
      ctx.addActivity({ type: "email_out", prospectId: p.id, clientId: p.clientId || null, text: `Prospection « ${seq.name} » — étape ${p.step}/${seq.steps.length} envoyée à ${p.email}`, subject: m.subject });
    } catch (e) {
      if (/\b55[0-4]\b|user unknown|does not exist|invalid recipient|no such user/i.test(e.message)) { p.status = "invalide"; p.nextAt = null; }
      else p.nextAt = now + 3600_000; // nouvel essai dans 1 h
      p.lastError = e.message.slice(0, 300);
    }
    db.update("prospects", list => { const i = list.findIndex(x => x.id === p.id); if (i >= 0) list[i] = { ...list[i], ...p }; });
    return p.id;
  };
  router.post("/prospection/send-now", requireAdmin, wrap(async (_req, res) => {
    if (!mail.configured()) throw new Error("Connectez d'abord votre boîte mail (Paramètres > Emails).");
    const id = await ctx.prospectionTick(true);
    res.json({ sent: !!id, prospectId: id });
  }));
  router.get("/prospection/state", requireAdmin, (_req, res) => {
    const st = db.get("prospstate"), t = parisNow(), s = db.get("settings").prospection;
    res.json({ sentToday: st.day === t.day ? st.count || 0 : 0, dailyLimit: s.dailyLimit, inWindow: !(t.hour < s.startHour || t.hour >= s.endHour || (s.weekdaysOnly && t.weekend)),
      queued: db.get("prospects").filter(p => p.status === "en_sequence").length, mailConfigured: mail.configured(), nafPresets: NAF_PRESETS });
  });
}
