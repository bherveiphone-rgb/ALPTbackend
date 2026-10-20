/* ============================================================
   MOTEUR DE TARIFICATION — partagé navigateur + serveur
   Toute la logique de prix vit ici : le back-office calcule en
   direct avec ce fichier et le serveur recalcule avec le même
   code à chaque enregistrement (le client ne peut rien falsifier).
   Tous les montants sont en euros HT, arrondis au centime.
   ============================================================ */

export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const num = v => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** Montant en euros ; jusqu'à 4 décimales pour les petits prix unitaires (impression). */
export const fmtEUR = n => {
  const v = Number(n) || 0;
  const precise = Math.abs(v) < 1 && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;
  return v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: precise ? 4 : 2 });
};

/** Index du palier de quantité applicable (dernier palier dont le minimum est atteint). */
export function breakIndex(breaks, qty) {
  let idx = 0;
  (breaks || []).forEach((b, i) => { if (qty >= b) idx = i; });
  return idx;
}

/** Choisit le plus petit format de la technique qui contient le visuel w × h (cm), rotation autorisée. */
export function pickFormat(tech, w, h) {
  w = Number(w); h = Number(h);
  const formats = [...(tech?.formats || [])]
    .filter(f => f.w > 0 && f.h > 0)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  if (!(w > 0 && h > 0) || !formats.length) return null;
  for (const f of formats) {
    if ((w <= f.w && h <= f.h) || (w <= f.h && h <= f.w)) return { format: f, over: false };
  }
  return { format: formats[formats.length - 1], over: true };
}

export function textileDiscountPct(settings, qty) {
  let pct = 0;
  for (const d of settings?.textileDiscounts || []) if (qty >= Number(d.min)) pct = Math.max(pct, Number(d.pct) || 0);
  return pct;
}

export const lineQty = line =>
  Object.values(line.sizes || {}).reduce((s, q) => s + (Math.max(0, parseInt(q, 10)) || 0), 0);

/** Clé de regroupement d'un marquage : même visuel + même technique = quantités cumulées et frais fixes payés une fois. */
export const persoGroupKey = (line, p) =>
  p.design && String(p.design).trim()
    ? `${p.techniqueId}|${String(p.design).trim().toLowerCase()}`
    : `${line.id}|${p.id}`;

/** Options choisies pour un marquage / imprimé (papier, recto-verso, finition…). */
export function selectedOptions(tech, p) {
  const ids = new Set(p?.options || []);
  return (tech?.options || []).filter(o => ids.has(o.id));
}

export const UNIVERSES = { textile: "Textile", objet: "Objets", print: "Print" };

/** Résout le format d'un marquage (manuel ou automatique à partir des dimensions). */
export function resolveFormat(tech, p) {
  if (!tech) return { format: null, over: false, auto: false };
  if (p.formatId) {
    const f = (tech.formats || []).find(x => x.id === p.formatId);
    if (f) return { format: f, over: false, auto: false };
  }
  const picked = pickFormat(tech, p.w, p.h);
  if (picked) return { ...picked, auto: true };
  return { format: (tech.formats || [])[0] || null, over: false, auto: true };
}

/**
 * Calcule un devis complet.
 * @param quote      le devis (lignes, frais, remise…)
 * @param techniques liste des techniques de marquage (avec grilles)
 * @param settings   paramètres (TVA, coef, dégressifs textile…)
 */
export function computeQuote(quote, techniques, settings) {
  const techById = Object.fromEntries((techniques || []).map(t => [t.id, t]));
  const warnings = [];
  const defaultCoef = num(settings?.defaultCoef) ?? 1.8;

  // 1er passage : quantités cumulées par groupe de marquage
  const groups = {};
  for (const line of quote.lines || []) {
    const q = lineQty(line);
    for (const p of line.perso || []) {
      const key = persoGroupKey(line, p);
      const g = (groups[key] ||= { key, qty: 0, colors: 1, techniqueId: p.techniqueId, design: p.design || "", positions: new Set(), setupOverride: null, fixed: 0, fixedLabels: new Set() });
      g.qty += q;
      // options à montant fixe (ex. création graphique, structure de roll-up) : comptées une fois par visuel
      const t = techById[p.techniqueId];
      for (const o of selectedOptions(t, p).filter(o => o.type === "fixed")) { g.fixed += num(o.value) ?? 0; g.fixedLabels.add(o.label); }
      g.colors = Math.max(g.colors, parseInt(p.colors, 10) || 1);
      if (p.position) g.positions.add(p.position);
    }
  }

  // 2e passage : lignes
  const lines = (quote.lines || []).map(line => {
    const qty = lineQty(line);
    const supplied = !!line.supplied;
    const coef = num(line.coef) ?? defaultCoef;
    const cost = num(line.cost) ?? 0;
    const basePrice = num(line.salePrice);         // prix de vente fixe de la référence
    const override = num(line.priceOverride);      // prix forcé dans le devis
    const discPct = supplied || override !== null || line.noDiscount ? 0 : textileDiscountPct(settings, qty);

    const sizeRows = Object.entries(line.sizes || {})
      .map(([size, q]) => [size, Math.max(0, parseInt(q, 10)) || 0])
      .filter(([, q]) => q > 0)
      .map(([size, q]) => {
        const surcharge = num(line.sizeSurcharges?.[size]) ?? 0;
        let unit = 0, unitCost = 0;
        if (!supplied) {
          unitCost = cost + surcharge;
          const ref = override ?? basePrice;
          unit = ref !== null ? ref + surcharge * coef : unitCost * coef;
          unit = r2(unit * (1 - discPct / 100));
        }
        return { size, qty: q, unit, cost: r2(unitCost), total: r2(unit * q) };
      });

    const textileTotal = r2(sizeRows.reduce((s, r) => s + r.total, 0));
    const textileCost = r2(sizeRows.reduce((s, r) => s + r.cost * r.qty, 0));
    const textileUnit = qty ? r2(textileTotal / qty) : (supplied ? 0 : r2((override ?? basePrice ?? cost * coef)));

    const persos = (line.perso || []).map(p => {
      const tech = techById[p.techniqueId];
      const w = [];
      if (!tech) return { id: p.id, techniqueId: p.techniqueId, techniqueName: "Technique supprimée", unit: num(p.unitOverride) ?? 0, total: 0, cost: 0, warnings: ["Technique introuvable"] };
      const key = persoGroupKey(line, p);
      const g = groups[key];
      const { format, over, auto } = resolveFormat(tech, p);
      const bi = breakIndex(tech.breaks, g.qty);
      const colors = tech.colorsEnabled ? Math.max(1, parseInt(p.colors, 10) || 1) : 1;
      const base = format ? num(tech.prices?.[format.id]?.[bi]) ?? 0 : 0;
      const extra = tech.colorsEnabled ? (colors - 1) * (num(tech.extraColorPrices?.[bi]) ?? 0) : 0;
      const opts = selectedOptions(tech, p);
      const pct = opts.filter(o => o.type === "pct").reduce((s, o) => s + (num(o.value) ?? 0), 0);
      const unitAdd = opts.filter(o => o.type === "unit").reduce((s, o) => s + (num(o.value) ?? 0), 0);
      // les imprimés ont des prix unitaires très bas (0,065 €) : 4 décimales pour ne pas fausser le total
      const computed = (tech.universe === "print" ? r4 : r2)((base + extra) * (1 + pct / 100) + unitAdd);
      const unitOverride = num(p.unitOverride);
      const unit = unitOverride ?? computed;
      if (over) w.push(`Le visuel ${p.w}×${p.h} cm dépasse le plus grand format « ${format.label} »`);
      if (tech.minQty && g.qty < tech.minQty) w.push(`${tech.name} : minimum conseillé ${tech.minQty} pièces (${g.qty} prévues)`);
      if (tech.colorsEnabled && tech.maxColors && colors > tech.maxColors) w.push(`${tech.name} : ${colors} couleurs > maximum ${tech.maxColors}`);
      if (!format) w.push(`${tech.name} : aucun format défini`);
      return {
        id: p.id, techniqueId: tech.id, techniqueName: tech.name, techniqueColor: tech.color,
        position: p.position || "", design: p.design || "", w: num(p.w), h: num(p.h), colors,
        colorsEnabled: !!tech.colorsEnabled, formatId: format?.id || "", formatLabel: format?.label || "—", auto, over,
        universe: tech.universe || "textile", options: opts.map(o => o.label),
        breakQty: g.qty, breakMin: tech.breaks?.[bi] ?? 1, computed, unit, overridden: unitOverride !== null,
        total: r2(unit * qty), cost: r2(unit * qty * (num(tech.costPct) ?? 40) / 100), groupKey: key, warnings: w,
      };
    });
    persos.forEach(p => p.warnings?.forEach(x => warnings.push(`${line.name || "Article"} — ${x}`)));

    const ru = line.kind === "print" ? r4 : r2;
    const persoUnit = ru(persos.reduce((s, p) => s + p.unit, 0));
    const persoTotal = r2(persos.reduce((s, p) => s + p.total, 0));
    const total = r2(textileTotal + persoTotal);
    if (!qty) warnings.push(`${line.name || "Article"} — aucune quantité saisie`);
    return {
      id: line.id, name: line.name || "", ref: line.ref || "", brand: line.brand || "", color: line.color || "",
      image: line.image || "", note: line.note || "", supplied, kind: line.kind || "article", universe: line.kind === "print" ? "print" : line.universe || "textile", qty, coef, discPct, sizeRows,
      textileUnit, textileTotal, textileCost, persos, persoUnit, persoTotal,
      unit: qty ? ru(total / qty) : ru(textileUnit + persoUnit), total,
      cost: r2(textileCost + persos.reduce((s, p) => s + p.cost, 0)),
    };
  });

  // Frais fixes (écrans, digitalisation…) — une fois par groupe
  const setups = [];
  for (const g of Object.values(groups)) {
    const tech = techById[g.techniqueId];
    if (!tech) continue;
    const computed = r2((num(tech.setupFee) ?? 0) + (tech.colorsEnabled ? (num(tech.setupPerColor) ?? 0) * g.colors : 0) + g.fixed);
    const ov = num(quote.setupOverrides?.[g.key]);
    const amount = ov ?? computed;
    if (computed === 0 && ov === null) continue;
    const where = [...g.positions].join(", ");
    setups.push({
      key: g.key, techniqueId: tech.id, computed, amount, overridden: ov !== null,
      label: `${tech.setupLabel || "Frais techniques"} ${tech.name}${g.design ? ` « ${g.design} »` : ""}${where ? ` — ${where}` : ""}${tech.colorsEnabled && num(tech.setupPerColor) ? ` (${g.colors} coul.)` : ""}${g.fixedLabels.size ? ` + ${[...g.fixedLabels].join(", ")}` : ""}`,
      cost: r2(amount * (num(tech.costPct) ?? 40) / 100),
    });
  }

  const fees = (quote.fees || []).map(f => {
    const qty = num(f.qty) ?? 1, unit = num(f.unit) ?? 0;
    return { id: f.id, label: f.label || "Frais", qty, unit, total: r2(qty * unit) };
  });

  const linesTotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const setupTotal = r2(setups.reduce((s, x) => s + x.amount, 0));
  const feesTotal = r2(fees.reduce((s, f) => s + f.total, 0));
  const subtotal = r2(linesTotal + setupTotal + feesTotal);
  const discountPct = num(quote.discountPct) ?? 0;
  const discount = r2(subtotal * discountPct / 100);
  const shipping = r2(num(quote.shipping) ?? 0);
  const ht = r2(subtotal - discount + shipping);
  const vatRate = num(quote.vatRate) ?? num(settings?.vatRate) ?? 20;
  const vat = r2(ht * vatRate / 100);
  const ttc = r2(ht + vat);
  const depositPct = num(quote.depositPct) ?? num(settings?.depositPct) ?? 0;
  const deposit = r2(ttc * depositPct / 100);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const cost = r2(lines.reduce((s, l) => s + l.cost, 0) + setups.reduce((s, x) => s + x.cost, 0));
  const marginBase = r2(subtotal - discount);
  const margin = r2(marginBase - cost);

  return {
    lines, setups, fees, warnings,
    totals: {
      qty: totalQty, textile: r2(lines.reduce((s, l) => s + l.textileTotal, 0)),
      perso: r2(lines.reduce((s, l) => s + l.persoTotal, 0)), linesTotal, setupTotal, feesTotal,
      subtotal, discountPct, discount, shipping, ht, vatRate, vat, ttc, depositPct, deposit,
      cost, margin, marginPct: marginBase ? r2(margin / marginBase * 100) : 0,
    },
  };
}

/** Tableau dégressif : prix unitaires d'une configuration (1 ligne) pour chaque palier de quantité. */
export function breakTable(line, techniques, settings, quantities) {
  const size = (line.availableSizes && line.availableSizes[0]) || "Unique";
  return quantities.map(q => {
    const c = computeQuote({ lines: [{ ...line, sizes: { [size]: q } }], fees: [] }, techniques, settings);
    const l = c.lines[0];
    const setup = c.totals.setupTotal;
    return {
      qty: q, textile: l.textileUnit, perso: l.persoUnit, unit: l.unit, setup,
      allIn: q ? r2((l.total + setup) / q) : 0, total: r2(l.total + setup),
      margin: c.totals.marginPct,
    };
  });
}

export const QUOTE_STATUSES = {
  brouillon: { label: "Brouillon", tone: "neutral" },
  envoye: { label: "Envoyé", tone: "info" },
  accepte: { label: "Accepté", tone: "success" },
  refuse: { label: "Refusé", tone: "danger" },
  production: { label: "En production", tone: "violet" },
  expedie: { label: "Expédié", tone: "info" },
  livre: { label: "Livré", tone: "success" },
  annule: { label: "Annulé", tone: "neutral" },
};

export const BAT_STATUSES = {
  aucun: { label: "Pas de BAT", tone: "neutral" },
  en_attente: { label: "BAT en attente", tone: "warning" },
  modif: { label: "Modif. demandée", tone: "danger" },
  valide: { label: "BAT validé", tone: "success" },
};

export function batStatusOf(quote) {
  const last = (quote.bats || [])[quote.bats?.length - 1];
  if (!last) return "aucun";
  return last.status === "valide" ? "valide" : last.status === "modif" ? "modif" : "en_attente";
}
