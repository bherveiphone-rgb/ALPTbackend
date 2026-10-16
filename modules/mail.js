/* Connexion à la boîte mail de l'atelier : envoi (SMTP) et lecture des réponses (IMAP).
   La configuration se fait dans Paramètres > Emails (ou via les variables SMTP_* / IMAP_* du .env). */

export const MAIL_PRESETS = {
  gmail: { label: "Gmail / Google Workspace", smtp: { host: "smtp.gmail.com", port: 465, secure: true }, imap: { host: "imap.gmail.com", port: 993, secure: true }, help: "Activez la validation en 2 étapes puis créez un « mot de passe d'application » (compte Google > Sécurité)." },
  outlook: { label: "Outlook / Microsoft 365", smtp: { host: "smtp.office365.com", port: 587, secure: false }, imap: { host: "outlook.office365.com", port: 993, secure: true }, help: "SMTP authentifié doit être autorisé sur la boîte (admin Microsoft 365)." },
  ovh: { label: "OVHcloud", smtp: { host: "ssl0.ovh.net", port: 465, secure: true }, imap: { host: "ssl0.ovh.net", port: 993, secure: true } },
  ionos: { label: "IONOS", smtp: { host: "smtp.ionos.fr", port: 465, secure: true }, imap: { host: "imap.ionos.fr", port: 993, secure: true } },
  orange: { label: "Orange", smtp: { host: "smtp.orange.fr", port: 465, secure: true }, imap: { host: "imap.orange.fr", port: 993, secure: true } },
  free: { label: "Free", smtp: { host: "smtp.free.fr", port: 465, secure: true }, imap: { host: "imap.free.fr", port: 993, secure: true } },
};

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** Remplace les variables {{nom}} d'un modèle. */
export const render = (tpl, vars) => String(tpl || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? "");
/** Version HTML minimale d'un texte (liens cliquables, sauts de ligne). */
export const textToHtml = t => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${esc(t)
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</div>`;
const addr = s => (String(s || "").match(/<([^>]+)>/)?.[1] || String(s || "")).trim().toLowerCase();

export function createMail(db) {
  let transport = null, transportKey = "";
  const cfg = () => {
    const m = db.get("settings").mail || {};
    const env = process.env;
    return {
      smtp: {
        host: env.SMTP_HOST || m.smtp?.host || "", port: Number(env.SMTP_PORT || m.smtp?.port || 587),
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : !!m.smtp?.secure,
        user: env.SMTP_USER || m.smtp?.user || "", pass: env.SMTP_PASS || m.smtp?.pass || "",
        from: env.SMTP_FROM || m.smtp?.from || m.smtp?.user || "",
      },
      imap: {
        enabled: env.IMAP_HOST ? true : !!m.imap?.enabled, host: env.IMAP_HOST || m.imap?.host || "",
        port: Number(env.IMAP_PORT || m.imap?.port || 993), secure: env.IMAP_SECURE ? env.IMAP_SECURE === "true" : m.imap?.secure !== false,
        user: env.IMAP_USER || m.imap?.user || m.smtp?.user || "", pass: env.IMAP_PASS || m.imap?.pass || m.smtp?.pass || "",
      },
    };
  };
  const configured = () => { const c = cfg().smtp; return !!(c.host && c.from); };
  const imapConfigured = () => { const c = cfg().imap; return !!(c.enabled && c.host && c.user && c.pass); };

  async function getTransport() {
    const c = cfg().smtp;
    if (!c.host) return null;
    const key = JSON.stringify(c);
    if (transport && key === transportKey) return transport;
    const nodemailer = (await import("nodemailer")).default;
    transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      pool: true, maxConnections: 2,
    });
    transportKey = key;
    return transport;
  }

  /** Envoie un email. Lève une erreur si l'envoi échoue. */
  async function send({ to, subject, text, html, replyTo, headers, cc, bcc }) {
    const t = await getTransport();
    if (!t) throw new Error("Aucune boîte mail connectée (Paramètres > Emails).");
    if (!to) throw new Error("Destinataire manquant.");
    const s = db.get("settings");
    const info = await t.sendMail({
      from: cfg().smtp.from, to, cc, bcc, subject, text, html: html || textToHtml(text),
      replyTo: replyTo || s.company?.email || undefined, headers,
    });
    return { ok: true, messageId: info.messageId };
  }
  /** Envoi « best effort » : ne lève jamais, renvoie false en cas d'échec. */
  async function trySend(opts) {
    if (!configured() || !opts.to) return false;
    try { await send(opts); return true; } catch (e) { console.error("Email non envoyé :", e.message); return false; }
  }

  async function verify() {
    const out = { smtp: null, imap: null };
    try { const t = await getTransport(); if (!t) throw new Error("SMTP non renseigné"); await t.verify(); out.smtp = { ok: true }; }
    catch (e) { out.smtp = { ok: false, error: e.message }; }
    if (cfg().imap.enabled) {
      try { const c = await imapClient(); await c.logout(); out.imap = { ok: true }; }
      catch (e) { out.imap = { ok: false, error: e.message }; }
    }
    return out;
  }

  async function imapClient() {
    const c = cfg().imap;
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, logger: false });
    await client.connect();
    return client;
  }

  /** Relève les nouveaux messages de la boîte de réception et les passe à onMessage. */
  let polling = false;
  async function poll(onMessage) {
    if (polling || !imapConfigured()) return 0;
    polling = true;
    let client, count = 0;
    try {
      client = await imapClient();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const state = db.get("mailstate");
        const box = client.mailbox;
        if (state.uidValidity !== String(box.uidValidity) || !state.lastUid) {
          // Première connexion : on part de maintenant (pas d'import de tout l'historique)
          db.set("mailstate", { uidValidity: String(box.uidValidity), lastUid: Math.max(0, (box.uidNext || 1) - 1), lastPoll: Date.now() });
          return 0;
        }
        const { simpleParser } = await import("mailparser");
        let lastUid = state.lastUid;
        for await (const msg of client.fetch(`${state.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= state.lastUid) continue;
          lastUid = Math.max(lastUid, msg.uid);
          try {
            const p = await simpleParser(msg.source);
            const from = p.from?.value?.[0] || {};
            await onMessage({
              uid: msg.uid, from: addr(from.address), fromName: from.name || "", subject: p.subject || "(sans objet)",
              text: (p.text || "").slice(0, 20000), date: p.date ? p.date.getTime() : Date.now(),
              messageId: p.messageId, inReplyTo: p.inReplyTo, to: (p.to?.value || []).map(x => addr(x.address)),
              autoReply: !!(p.headers.get("auto-submitted") && p.headers.get("auto-submitted") !== "no") || /^(auto|automatic reply|réponse automatique|absence)/i.test(p.subject || ""),
            });
            count++;
          } catch (e) { console.error("Email illisible :", e.message); }
        }
        db.set("mailstate", { ...state, lastUid, lastPoll: Date.now(), lastError: null });
      } finally { lock.release(); }
    } catch (e) {
      db.set("mailstate", { ...db.get("mailstate"), lastError: e.message, lastPoll: Date.now() });
      console.error("IMAP :", e.message);
    } finally {
      polling = false;
      try { await client?.logout(); } catch { /* déjà fermé */ }
    }
    return count;
  }

  return { cfg, configured, imapConfigured, send, trySend, verify, poll, render };
}
