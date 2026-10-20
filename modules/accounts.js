/* Comptes utilisateurs : connexion par email + mot de passe, rôles « admin » et « employé ».
   Le mot de passe ADMIN_PASSWORD reste valable (compte propriétaire).
   Un employé ne voit jamais les prix d'achat, coefficients ni marges : ils sont retirés
   des réponses côté serveur, et les prix de ses devis sont calculés par le serveur. */
import crypto from "crypto";
import { uid, clean, normEmail, DAY } from "./core.js";
import { computeQuote } from "../public/devis/pricing.js";

export const ROLES = { admin: "Administrateur", employe: "Employé" };
const SESSION_DAYS = 30;
const HIDDEN = new Set(["cost", "textileCost", "unitCost", "margin", "marginPct", "costPct", "coef", "defaultCoef", "sizeSurcharges"]);

// Routes réservées aux administrateurs (méthode facultative)
const ADMIN_ONLY = [
  [/^\/settings/, "PUT"], [/^\/mail\/test/], [/^\/backup/], [/^\/restore/], [/^\/users/], [/^\/stats/],
  [/^\/(catalog|techniques)(\/|$)/, "WRITE"], [/^\/qonto/], [/^\/bank/], [/^\/pennylane/], [/^\/suppliers/],
  [/^\/quote-templates/, "DELETE"], [/^\/billing/], [/^\/automation/, "POST"], [/^\/quotes\/[^/]+\/(invoice|payment)/],
];

const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString("hex") });
const checkPw = (pw, u) => {
  if (!u?.hash) return false;
  const a = Buffer.from(crypto.scryptSync(String(pw), u.salt, 64).toString("hex")), b = Buffer.from(u.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sha = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Retire récursivement les champs de coût d'une réponse. */
export function maskCosts(v) {
  if (Array.isArray(v)) return v.map(maskCosts);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!HIDDEN.has(k)) o[k] = maskCosts(x);
    return o;
  }
  return v;
}

const tries = new Map();
const limited = ip => {
  const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 15 * 60e3);
  t.push(now); tries.set(ip, t);
  return t.length > 20;
};

export const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });

export function setupAccounts(ctx, adminPassword) {
  const { db } = ctx;
  const OWNER = { id: "owner", name: "Administrateur", email: "", role: "admin" };

  function userFromReq(req) {
    const pw = req.get("x-admin-password");
    if (pw && adminPassword && safeEq(pw, adminPassword)) return OWNER;
    const tok = req.get("x-auth-token");
    if (!tok) return null;
    const s = db.get("sessions").find(x => x.hash === sha(tok) && x.exp > Date.now());
    if (!s) return null;
    const u = db.get("users").find(x => x.id === s.userId && x.active !== false);
    return u ? publicUser(u) : null;
  }

  ctx.requireAdmin = (req, res, next) => {
    const u = userFromReq(req);
    if (!u) return res.status(401).json({ error: "Non autorisé" });
    req.user = u;
    if (u.role !== "admin") {
      const write = req.method !== "GET";
      const blocked = ADMIN_ONLY.some(([re, m]) => re.test(req.path) && (!m || m === req.method || (m === "WRITE" && write)));
      if (blocked) return res.status(403).json({ error: "Réservé à un administrateur" });
      const json = res.json.bind(res);
      res.json = body => json(maskCosts(body));
    }
    next();
  };
  ctx.isEmployee = req => req.user && req.user.role !== "admin";

  /** Un employé renvoie des lignes sans prix d'achat : on les reprend du devis enregistré ou du catalogue. */
  ctx.restoreCosts = (lines, previous = []) => {
    const catalog = db.get("catalog");
    for (const l of lines || []) {
      const old = previous.find(x => x.id === l.id);
      const a = catalog.find(x => x.id === l.articleId);
      for (const k of ["cost", "coef", "salePrice", "sizeSurcharges"]) {
        if (old && k in old) l[k] = old[k];
        else if (a && k in a) l[k] = a[k];
        else delete l[k];
      }
    }
    return lines;
  };

  return function accountRoutes(router) {
    const { requireAdmin, wrap } = ctx;

    router.post("/auth/login", wrap((req, res) => {
      if (limited(req.ip)) return res.status(429).json({ error: "Trop de tentatives, réessayez dans 15 minutes." });
      const email = normEmail(req.body?.email), pw = String(req.body?.password || "");
      const u = db.get("users").find(x => x.email === email && x.active !== false);
      if (!u || !checkPw(pw, u)) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
      const tok = crypto.randomBytes(32).toString("base64url");
      db.update("sessions", l => {
        const now = Date.now();
        l.splice(0, l.length, ...l.filter(s => s.exp > now));
        l.push({ hash: sha(tok), userId: u.id, exp: now + SESSION_DAYS * DAY, at: now, ua: clean(req.get("user-agent"), 200) });
      });
      db.update("users", l => { const x = l.find(y => y.id === u.id); if (x) x.lastLoginAt = Date.now(); });
      res.json({ token: tok, user: publicUser(u) });
    }));
    router.post("/auth/logout", (req, res) => {
      const tok = req.get("x-auth-token");
      if (tok) db.update("sessions", l => { const i = l.findIndex(s => s.hash === sha(tok)); if (i >= 0) l.splice(i, 1); });
      res.json({ ok: true });
    });
    router.get("/auth/me", requireAdmin, (req, res) => res.json(req.user));
    router.put("/auth/password", requireAdmin, wrap((req, res) => {
      if (req.user.id === "owner") throw new Error("Le mot de passe principal se change dans le fichier .env (ADMIN_PASSWORD).");
      const u = db.get("users").find(x => x.id === req.user.id);
      if (!checkPw(req.body?.current || "", u)) throw new Error("Mot de passe actuel incorrect");
      if (String(req.body?.password || "").length < 8) throw new Error("8 caractères minimum");
      db.update("users", l => Object.assign(l.find(x => x.id === u.id), hashPw(req.body.password)));
      res.json({ ok: true });
    }));

    /* ----- Gestion des comptes (administrateurs) ----- */
    router.get("/users", requireAdmin, (_req, res) => res.json(db.get("users").map(publicUser)));
    const fields = (b, isNew) => {
      const o = {};
      if ("name" in b || isNew) o.name = clean(b.name, 120).trim();
      if ("email" in b || isNew) o.email = normEmail(b.email);
      if ("role" in b || isNew) o.role = ROLES[b.role] ? b.role : "employe";
      if ("active" in b) o.active = b.active !== false;
      if (b.password) { if (String(b.password).length < 8) throw new Error("Mot de passe : 8 caractères minimum"); Object.assign(o, hashPw(b.password)); }
      if (isNew && !o.hash) throw new Error("Mot de passe requis");
      if (("email" in o) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error("Email invalide");
      return o;
    };
    router.post("/users", requireAdmin, wrap((req, res) => {
      const o = fields(req.body || {}, true);
      if (db.get("users").some(x => x.email === o.email)) throw new Error("Un compte existe déjà avec cet email");
      const u = { id: uid("u"), createdAt: Date.now(), active: true, ...o, name: o.name || o.email };
      db.update("users", l => l.push(u));
      res.json(publicUser(u));
    }));
    router.put("/users/:id", requireAdmin, wrap((req, res) => {
      const o = fields(req.body || {}, false);
      if (o.email && db.get("users").some(x => x.email === o.email && x.id !== req.params.id)) throw new Error("Un compte existe déjà avec cet email");
      const u = db.update("users", l => { const x = l.find(y => y.id === req.params.id); if (x) Object.assign(x, o); return x; });
      if (!u) return res.status(404).json({ error: "Compte introuvable" });
      if (o.hash || o.active === false) db.update("sessions", l => l.splice(0, l.length, ...l.filter(s => s.userId !== u.id)));
      res.json(publicUser(u));
    }));
    router.delete("/users/:id", requireAdmin, (req, res) => {
      db.set("users", db.get("users").filter(x => x.id !== req.params.id));
      db.update("sessions", l => l.splice(0, l.length, ...l.filter(s => s.userId !== req.params.id)));
      res.json({ ok: true });
    });

    /* ----- Calcul serveur (employés : les prix d'achat restent côté serveur) ----- */
    router.post("/quotes/preview", requireAdmin, wrap((req, res) => {
      const q = structuredClone(req.body?.quote || {});
      const prev = db.get("quotes").find(x => x.id === q.id);
      if (ctx.isEmployee(req)) ctx.restoreCosts(q.lines, prev?.lines);
      const techs = prev ? ctx.techsFor({ ...prev, lines: q.lines }) : db.get("techniques");
      res.json(computeQuote(q, techs, db.get("settings")));
    }));
  };
}
