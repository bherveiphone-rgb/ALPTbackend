/* Données de départ et valeurs par défaut de l'outil (premier démarrage ou nouveaux paramètres). */
/* ---------------- Données de départ ---------------- */
const SIZES_ADULT = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
export const SEED_SETTINGS = {
  company: {
    name: "Mon atelier de personnalisation", address: "", zip: "", city: "", country: "France",
    email: "", phone: "", website: "", siret: "", vatNumber: "", iban: "", bic: "", logo: "",
  },
  vatRate: 20, defaultCoef: 1.8, validityDays: 30, depositPct: 30, leadTime: "10 à 15 jours ouvrés après validation du BAT",
  quotePrefix: "DEV", nextNumber: 1,
  textileDiscounts: [{ min: 50, pct: 3 }, { min: 100, pct: 5 }, { min: 250, pct: 8 }, { min: 500, pct: 12 }],
  positions: ["Cœur", "Poitrine centre", "Dos", "Haut du dos", "Nuque", "Manche gauche", "Manche droite", "Bas de face", "Cuisse", "Face avant (casquette)", "Côté"],
  extraFees: [
    { id: "f1", label: "Vectorisation / retouche du logo", unit: 25, perPiece: false },
    { id: "f2", label: "Échantillon physique avant production", unit: 30, perPiece: false },
    { id: "f3", label: "Ensachage individuel", unit: 0.3, perPiece: true },
    { id: "f4", label: "Livraison express", unit: 35, perPiece: false },
  ],
  batChecklist: [
    "L'orthographe et les textes sont corrects",
    "Les couleurs (et références Pantone) sont conformes",
    "Les dimensions et emplacements des marquages sont validés",
    "Les quantités, couleurs de textile et tailles sont correctes",
  ],
  conditions: "Devis valable 30 jours. Production lancée après validation du BAT et réception de l'acompte. " +
    "Tolérance de ±3 % sur les quantités et de ±5 mm sur les positionnements. Les couleurs à l'écran peuvent légèrement différer du rendu final.",
  onlinePayment: false, notifyEmail: "", emailSignature: "",
};

const fmt = (id, label, w, h) => ({ id, label, w, h });
export const SEED_TECHNIQUES = [
  {
    id: "serigraphie", name: "Sérigraphie", color: "#2563eb", colorsEnabled: true, maxColors: 8, minQty: 25,
    setupFee: 0, setupPerColor: 25, setupLabel: "Écrans", costPct: 35,
    description: "Idéal pour les séries, couleurs franches, excellente tenue.",
    formats: [fmt("coeur", "Cœur (≤ 10×10 cm)", 10, 10), fmt("a5", "A5 (≤ 15×21 cm)", 15, 21), fmt("a4", "A4 (≤ 21×30 cm)", 21, 30), fmt("a3", "A3 (≤ 30×42 cm)", 30, 42)],
    breaks: [25, 50, 100, 250, 500, 1000],
    prices: {
      coeur: [2.9, 2.2, 1.6, 1.2, 0.95, 0.8], a5: [3.4, 2.6, 1.9, 1.4, 1.1, 0.9],
      a4: [3.9, 2.9, 2.2, 1.6, 1.3, 1.05], a3: [4.9, 3.6, 2.7, 1.95, 1.55, 1.25],
    },
    extraColorPrices: [1.2, 0.9, 0.65, 0.45, 0.35, 0.28],
  },
  {
    id: "broderie", name: "Broderie", color: "#db2777", colorsEnabled: false, maxColors: 12, minQty: 1,
    setupFee: 45, setupPerColor: 0, setupLabel: "Digitalisation", costPct: 40,
    description: "Rendu premium et durable, idéal polos, casquettes, softshells. Prix selon nombre de points.",
    formats: [fmt("p", "Petit ≤ 8×8 cm (~5 000 pts)", 8, 8), fmt("m", "Moyen ≤ 12×12 cm (~10 000 pts)", 12, 12), fmt("g", "Grand ≤ 25×25 cm (~25 000 pts)", 25, 25)],
    breaks: [1, 10, 25, 50, 100, 250, 500],
    prices: { p: [6.5, 4.9, 3.9, 3.2, 2.7, 2.3, 2.0], m: [8.9, 6.9, 5.5, 4.6, 3.9, 3.3, 2.9], g: [18, 14, 11.5, 9.5, 8, 7, 6.2] },
    extraColorPrices: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "dtf", name: "Transfert DTF", color: "#ea580c", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45,
    description: "Quadrichromie sans frais fixes, parfait pour les petites séries et les visuels détaillés.",
    formats: [fmt("a7", "A7 (≤ 7,4×10,5 cm)", 7.4, 10.5), fmt("a6", "A6 (≤ 10,5×14,8 cm)", 10.5, 14.8), fmt("a5", "A5 (≤ 14,8×21 cm)", 14.8, 21), fmt("a4", "A4 (≤ 21×29,7 cm)", 21, 29.7), fmt("a3", "A3 (≤ 29,7×42 cm)", 29.7, 42)],
    breaks: [1, 10, 25, 50, 100, 250],
    prices: {
      a7: [4.5, 3.2, 2.5, 2.0, 1.6, 1.3], a6: [5.5, 3.9, 3.0, 2.5, 2.0, 1.7], a5: [7, 5, 3.9, 3.2, 2.6, 2.2],
      a4: [9.5, 6.9, 5.4, 4.5, 3.7, 3.1], a3: [13.5, 9.9, 7.8, 6.5, 5.4, 4.6],
    },
    extraColorPrices: [0, 0, 0, 0, 0, 0],
  },
  {
    id: "flocage", name: "Flocage / Flex", color: "#16a34a", colorsEnabled: true, maxColors: 3, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 40,
    description: "Noms, numéros et logos simples en flex ou floqué, idéal tenues sportives.",
    formats: [fmt("num_s", "Petit numéro / initiales (≤ 10×10 cm)", 10, 10), fmt("nom", "Nom (≤ 30×8 cm)", 30, 8), fmt("num_l", "Numéro dos (≤ 20×25 cm)", 20, 25), fmt("logo", "Logo A4 (≤ 21×30 cm)", 21, 30)],
    breaks: [1, 10, 25, 50, 100],
    prices: { num_s: [3.5, 3, 2.6, 2.3, 2], nom: [5, 4.2, 3.6, 3.2, 2.8], num_l: [6, 5, 4.4, 3.9, 3.4], logo: [8.5, 7, 6, 5.2, 4.5] },
    extraColorPrices: [2.5, 2, 1.7, 1.5, 1.3],
  },
];

const art = (id, ref, name, brand, category, cost, colors, sizes, sizeSurcharges = {}, coef = null) =>
  ({ id, ref, name, brand, category, cost, coef, salePrice: null, colors, sizes, sizeSurcharges, image: "", notes: "" });
export const SEED_CATALOG = [
  art("a1", "STTU755", "Creator 2.0 — T-shirt unisexe bio", "Stanley/Stella", "T-shirt", 4.2, ["Blanc", "Noir", "French Navy", "Heather Grey", "Red", "Bright Blue"], ["XXS", ...SIZES_ADULT], { "2XL": 0.6, "3XL": 1.2 }),
  art("a2", "K356", "T-shirt col rond homme", "Kariban", "T-shirt", 2.35, ["Blanc", "Noir", "Navy", "Gris chiné", "Rouge", "Royal"], SIZES_ADULT, { "2XL": 0.4, "3XL": 0.8 }),
  art("a3", "TU01T", "#E190 T-shirt", "B&C", "T-shirt", 2.1, ["Blanc", "Noir", "Navy", "Sport Grey", "Red"], SIZES_ADULT, { "2XL": 0.35, "3XL": 0.7 }),
  art("a4", "K241", "Polo manches courtes homme", "Kariban", "Polo", 6.9, ["Blanc", "Noir", "Navy", "Royal"], SIZES_ADULT, { "2XL": 0.8, "3XL": 1.5 }),
  art("a5", "STSU823", "Cruiser 2.0 — Sweat capuche bio", "Stanley/Stella", "Sweat", 18.5, ["Noir", "French Navy", "Heather Grey", "Off White"], ["XS", "S", "M", "L", "XL", "2XL"], { "2XL": 1.5 }, 1.6),
  art("a6", "K474", "Sweat-shirt à capuche", "Kariban", "Sweat", 11.9, ["Noir", "Navy", "Gris chiné", "Bordeaux"], SIZES_ADULT, { "2XL": 1, "3XL": 2 }, 1.7),
  art("a7", "K401", "Veste softshell homme", "Kariban", "Veste", 21.9, ["Noir", "Navy", "Gris"], SIZES_ADULT, { "2XL": 1.5, "3XL": 3 }, 1.6),
  art("a8", "B15", "Casquette 5 panneaux", "Beechfield", "Accessoire", 2.6, ["Noir", "Navy", "Blanc", "Rouge"], ["Unique"]),
  art("a9", "W101", "Tote bag coton", "Westford Mill", "Bagagerie", 1.45, ["Naturel", "Noir", "Navy"], ["Unique"], {}, 2),
];


/* ---------------- CRM, workflow et automatisations ---------------- */
// Étapes de production (tableau Production). Les clés sont fixes, les libellés modifiables.
export const PRODUCTION_STAGES = [
  { key: "a_lancer", label: "À lancer" },
  { key: "commande", label: "Textile commandé" },
  { key: "marquage", label: "En marquage" },
  { key: "controle", label: "Contrôle & emballage" },
  { key: "expedie", label: "Expédié / prêt" },
  { key: "livre", label: "Livré" },
];

// Modèles d'emails. Variables : {{contact}} {{client}} {{numero}} {{objet}} {{lien}} {{montant_ht}} {{montant_ttc}}
// {{acompte}} {{atelier}} {{signature}} {{transporteur}} {{suivi}} {{lien_suivi}} {{version}} {{date_limite}}
export const DEFAULT_TEMPLATES = {
  request_ack: { label: "Accusé de réception d'une demande", subject: "Nous avons bien reçu votre demande ({{numero}})",
    body: "Bonjour {{contact}},\n\nMerci pour votre demande de devis ! Nous l'étudions et revenons vers vous très rapidement (sous 24 h ouvrées).\n\nVous pouvez nous répondre directement à cet email pour compléter votre demande.\n\n{{signature}}" },
  quote_sent: { label: "Envoi du devis", subject: "Votre devis {{numero}} — {{objet}}",
    body: "Bonjour {{contact}},\n\nVeuillez trouver votre devis {{numero}} d'un montant de {{montant_ht}} HT ({{montant_ttc}} TTC).\n\nVous pouvez le consulter, le télécharger en PDF et l'accepter en ligne en un clic :\n{{lien}}\n\nN'hésitez pas à me contacter pour toute question.\n\n{{signature}}" },
  quote_reminder: { label: "Relance devis sans réponse", subject: "Votre devis {{numero}} — avez-vous pu le consulter ?",
    body: "Bonjour {{contact}},\n\nJe me permets de revenir vers vous concernant le devis {{numero}} ({{montant_ht}} HT).\nAvez-vous des questions ou souhaitez-vous des ajustements (quantités, couleurs, marquages) ?\n\nLe devis reste consultable et validable en ligne jusqu'au {{date_limite}} :\n{{lien}}\n\n{{signature}}" },
  bat_sent: { label: "BAT à valider", subject: "BAT V{{version}} à valider — {{numero}}",
    body: "Bonjour {{contact}},\n\nVotre BAT (V{{version}}) est prêt. Merci de le vérifier attentivement (orthographe, couleurs, dimensions, emplacements) puis de le valider en ligne ou de demander une modification :\n{{lien}}\n\nLa production démarre dès votre validation.\n\n{{signature}}" },
  bat_reminder: { label: "Relance BAT en attente", subject: "Rappel : votre BAT {{numero}} attend votre validation",
    body: "Bonjour {{contact}},\n\nVotre BAT est toujours en attente de validation. Pour tenir les délais, merci de le valider (ou de nous indiquer vos modifications) :\n{{lien}}\n\n{{signature}}" },
  deposit_reminder: { label: "Rappel acompte", subject: "Acompte pour lancer votre commande {{numero}}",
    body: "Bonjour {{contact}},\n\nMerci pour votre confiance ! Pour lancer la production, il nous reste à recevoir l'acompte de {{acompte}}.\nToutes les informations de règlement sont sur votre espace :\n{{lien}}\n\n{{signature}}" },
  production_started: { label: "Production lancée", subject: "Votre commande {{numero}} est en production",
    body: "Bonjour {{contact}},\n\nBonne nouvelle : votre commande {{numero}} est lancée en production. Vous pouvez suivre son avancement ici :\n{{lien}}\n\n{{signature}}" },
  shipped: { label: "Commande expédiée", subject: "Votre commande {{numero}} est expédiée 📦",
    body: "Bonjour {{contact}},\n\nVotre commande {{numero}} vient d'être expédiée ({{transporteur}}).\nNuméro de suivi : {{suivi}}\n{{lien_suivi}}\n\nSuivi de commande : {{lien}}\n\n{{signature}}" },
  ready_pickup: { label: "Commande prête (retrait)", subject: "Votre commande {{numero}} est prête !",
    body: "Bonjour {{contact}},\n\nVotre commande {{numero}} est prête et vous attend à l'atelier.\n\n{{signature}}" },
  review_request: { label: "Demande d'avis après livraison", subject: "Votre avis compte — commande {{numero}}",
    body: "Bonjour {{contact}},\n\nVous avez reçu votre commande {{numero}} : tout est conforme ? Votre retour nous aide beaucoup (30 secondes) :\n{{lien}}\n\nEt pour vos prochains besoins (nouveaux membres, événements…), nous sommes là !\n\n{{signature}}" },
};

export const DEFAULT_AUTOMATION = {
  enabled: true,
  quoteReminderDays: [3, 7],     // relances après envoi du devis
  autoSendQuoteReminders: false, // false = crée une tâche ; true = envoie l'email automatiquement
  batReminderDays: 2, autoSendBatReminders: true,
  depositReminderDays: 3, autoSendDepositReminders: false,
  expiringDays: 2,               // tâche avant expiration du devis
  requestResponseHours: 24,      // tâche si une demande n'est pas traitée
  deadlineWarningDays: 5,        // alerte production si la date souhaitée approche
  autoStatusEmails: true,        // BAT, production lancée, expédition, prêt au retrait
  reviewAfterDays: 3, autoSendReview: true,
  reactivationMonths: 10,        // tâche « recontacter » un client sans commande depuis N mois
  inboundToRequest: false,       // emails d'inconnus contenant « devis » → nouvelle demande
};

export const DEFAULT_PROSPECTION = {
  dailyLimit: 40, minGapMinutes: 4, startHour: 9, endHour: 18, weekdaysOnly: true,
  footer: "Vous recevez cet email car votre structure pourrait être intéressée par nos services de textile personnalisé. Pour ne plus recevoir nos messages : {{desinscription}}",
};

export const SEED_SEQUENCES = [{
  id: "seq_clubs", name: "Clubs sportifs — tenues de saison", active: false, createdAt: Date.now(),
  steps: [
    { delayDays: 0, subject: "Tenues personnalisées pour {{societe}}",
      body: "Bonjour {{prenom}},\n\nJe suis {{atelier_contact}} de {{atelier}}, atelier de textile personnalisé. Nous équipons des clubs comme {{societe}} : maillots, sweats, polos des bénévoles, avec votre logo en sérigraphie, broderie ou transfert.\n\nPour la saison qui arrive, souhaitez-vous recevoir une proposition chiffrée ? Il suffit de répondre à cet email avec vos besoins approximatifs (quantités, articles).\n\nBelle journée,\n{{signature}}" },
    { delayDays: 4, subject: "Re: Tenues personnalisées pour {{societe}}",
      body: "Bonjour {{prenom}},\n\nPetit message de suivi : vous pouvez aussi faire votre demande en 2 minutes ici, avec votre logo et les dimensions souhaitées :\n{{lien_demande}}\n\nDevis sous 24 h, BAT validé en ligne avant toute production.\n\n{{signature}}" },
    { delayDays: 10, subject: "Dernier message — {{societe}}",
      body: "Bonjour {{prenom}},\n\nJe ne veux pas vous importuner : c'est mon dernier message. Si le sujet des tenues ou goodies personnalisés revient chez {{societe}}, gardez simplement notre contact.\n\nSportivement,\n{{signature}}" },
  ],
}];

const isObj = v => v && typeof v === "object" && !Array.isArray(v);
/** Fusionne les paramètres enregistrés avec les valeurs par défaut (nouveaux champs après mise à jour). */
export function mergeSettings(v) {
  const s = { ...SEED_SETTINGS, ...v };
  s.company = { ...SEED_SETTINGS.company, ...(v.company || {}) };
  s.automation = { ...DEFAULT_AUTOMATION, ...(isObj(v.automation) ? v.automation : {}) };
  s.prospection = { ...DEFAULT_PROSPECTION, ...(isObj(v.prospection) ? v.prospection : {}) };
  s.templates = Object.fromEntries(Object.entries(DEFAULT_TEMPLATES).map(([k, d]) => [k, { ...d, ...(v.templates?.[k] || {}), label: d.label }]));
  s.productionStages = PRODUCTION_STAGES.map(st => ({ ...st, label: v.productionStages?.find(x => x.key === st.key)?.label || st.label }));
  s.mail = { smtp: {}, imap: {}, ...(v.mail || {}) };
  s.pennylane = { apiKey: "", draft: true, ...(v.pennylane || {}) };
  s.tags = Array.isArray(v.tags) ? v.tags : ["Club", "Association", "Entreprise", "École", "Collectivité", "Événement", "VIP"];
  s.lostReasons = Array.isArray(v.lostReasons) ? v.lostReasons : ["Prix trop élevé", "Délai trop long", "Concurrent", "Projet abandonné", "Pas de réponse"];
  return s;
}

/* ---------------- Objets personnalisés & print (ajoutés en v2) ---------------- */
const o = (id, label, group, type, value) => ({ id, label, group, type, value });
export const SEED_TECHNIQUES_V2 = [
  // --- Objets ---
  {
    id: "tampo", universe: "objet", name: "Tampographie", color: "#0891b2", colorsEnabled: true, maxColors: 4, minQty: 100,
    setupFee: 0, setupPerColor: 35, setupLabel: "Cliché", costPct: 35, description: "Stylos, gourdes, objets en plastique : marquage 1 à 4 couleurs.",
    formats: [fmt("s", "Petit ≤ 4×2 cm", 4, 2), fmt("m", "Moyen ≤ 6×3 cm", 6, 3), fmt("l", "Grand ≤ 9×5 cm", 9, 5)],
    breaks: [100, 250, 500, 1000, 2500, 5000],
    prices: { s: [0.45, 0.3, 0.22, 0.16, 0.12, 0.1], m: [0.55, 0.38, 0.28, 0.2, 0.15, 0.12], l: [0.7, 0.48, 0.35, 0.26, 0.2, 0.16] },
    extraColorPrices: [0.25, 0.18, 0.13, 0.1, 0.08, 0.06], options: [],
  },
  {
    id: "laser", universe: "objet", name: "Gravure laser", color: "#78716c", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 15, setupPerColor: 0, setupLabel: "Programmation", costPct: 30, description: "Métal, bois, verre, cuir : gravure fine et indélébile.",
    formats: [fmt("s", "Petit ≤ 3×1 cm", 3, 1), fmt("m", "Moyen ≤ 6×3 cm", 6, 3), fmt("l", "Grand ≤ 10×6 cm", 10, 6)],
    breaks: [1, 10, 50, 100, 250, 500],
    prices: { s: [3.5, 2, 1.1, 0.8, 0.6, 0.5], m: [5, 2.8, 1.6, 1.2, 0.9, 0.75], l: [7.5, 4.2, 2.4, 1.8, 1.4, 1.1] },
    extraColorPrices: [0, 0, 0, 0, 0, 0], options: [o("deux", "Gravure 2 faces", "", "pct", 80), o("nom", "Prénom personnalisé par pièce", "", "unit", 1.5)],
  },
  {
    id: "uv", universe: "objet", name: "Impression UV quadri", color: "#a855f7", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 40, description: "Quadrichromie directe sur objet (coques, plaques, goodies).",
    formats: [fmt("s", "≤ 5×5 cm", 5, 5), fmt("m", "≤ 10×10 cm", 10, 10), fmt("l", "≤ 20×20 cm", 20, 20)],
    breaks: [1, 10, 50, 100, 250, 500],
    prices: { s: [4, 2.5, 1.5, 1.1, 0.85, 0.7], m: [6.5, 4, 2.4, 1.8, 1.4, 1.15], l: [11, 7, 4.2, 3.2, 2.5, 2.1] },
    extraColorPrices: [0, 0, 0, 0, 0, 0], options: [o("blanc", "Sous-couche blanche", "", "pct", 15), o("vernis", "Vernis sélectif", "", "pct", 25)],
  },
  {
    id: "sublim", universe: "objet", name: "Sublimation (mugs, tapis…)", color: "#e11d48", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 40, description: "Photo et quadri sur supports polyester : mugs, tapis de souris, plaques.",
    formats: [fmt("s", "Face ≤ 9×8 cm", 9, 8), fmt("p", "Panoramique ≤ 20×8 cm", 20, 8)],
    breaks: [1, 10, 25, 50, 100, 250],
    prices: { s: [5, 3.2, 2.6, 2.1, 1.8, 1.5], p: [7, 4.5, 3.6, 3, 2.5, 2.1] },
    extraColorPrices: [0, 0, 0, 0, 0, 0], options: [o("boite", "Boîte individuelle", "", "unit", 0.9)],
  },
  // --- Print (prix unitaires par exemplaire selon la quantité) ---
  {
    id: "flyers", universe: "print", name: "Flyers / tracts", color: "#f59e0b", colorsEnabled: false, maxColors: 0, minQty: 100,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45, description: "Quadri, papier couché.",
    formats: [fmt("a6", "A6 (10,5×14,8 cm)", 10.5, 14.8), fmt("a5", "A5 (14,8×21 cm)", 14.8, 21), fmt("dl", "DL (10×21 cm)", 10, 21), fmt("a4", "A4 (21×29,7 cm)", 21, 29.7)],
    breaks: [100, 250, 500, 1000, 2500, 5000],
    prices: { a6: [0.22, 0.11, 0.07, 0.045, 0.03, 0.022], a5: [0.32, 0.16, 0.1, 0.065, 0.042, 0.032], dl: [0.28, 0.14, 0.09, 0.058, 0.038, 0.028], a4: [0.55, 0.28, 0.18, 0.12, 0.08, 0.06] },
    extraColorPrices: [0, 0, 0, 0, 0, 0],
    options: [o("p135", "Papier 135 g", "Papier", "pct", 0), o("p170", "Papier 170 g", "Papier", "pct", 12), o("p350", "Papier 350 g (carton)", "Papier", "pct", 45),
      o("rv", "Recto-verso", "Impression", "pct", 25), o("pellic", "Pelliculage mat", "Finition", "unit", 0.04), o("crea", "Création graphique", "", "fixed", 60)],
  },
  {
    id: "cartes", universe: "print", name: "Cartes de visite", color: "#0ea5e9", colorsEnabled: false, maxColors: 0, minQty: 100,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45, description: "Format 85×55 mm, quadri.",
    formats: [fmt("std", "85×55 mm", 8.5, 5.5), fmt("carre", "Carrée 55×55 mm", 5.5, 5.5)],
    breaks: [100, 250, 500, 1000, 2500],
    prices: { std: [0.25, 0.12, 0.075, 0.05, 0.035], carre: [0.28, 0.14, 0.085, 0.056, 0.04] },
    extraColorPrices: [0, 0, 0, 0, 0],
    options: [o("p350", "Papier 350 g", "Papier", "pct", 0), o("p400", "Papier 400 g premium", "Papier", "pct", 20),
      o("rv", "Recto-verso", "Impression", "pct", 20), o("soft", "Pelliculage soft-touch", "Finition", "pct", 35), o("crea", "Création graphique", "", "fixed", 45)],
  },
  {
    id: "affiches", universe: "print", name: "Affiches", color: "#ef4444", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45, description: "Quadri, papier 135 g ou photo.",
    formats: [fmt("a3", "A3 (29,7×42 cm)", 29.7, 42), fmt("a2", "A2 (42×59,4 cm)", 42, 59.4), fmt("a1", "A1 (59,4×84 cm)", 59.4, 84), fmt("a0", "A0 (84×119 cm)", 84, 119)],
    breaks: [1, 10, 25, 50, 100, 250],
    prices: { a3: [4, 1.6, 1, 0.75, 0.55, 0.42], a2: [9, 4, 2.6, 1.9, 1.4, 1.1], a1: [16, 8, 5.5, 4.2, 3.2, 2.6], a0: [28, 15, 10, 8, 6.2, 5] },
    extraColorPrices: [0, 0, 0, 0, 0, 0],
    options: [o("photo", "Papier photo satiné", "Papier", "pct", 35), o("dos", "Papier dos bleu (affichage)", "Papier", "pct", 10), o("crea", "Création graphique", "", "fixed", 60)],
  },
  {
    id: "stickers", universe: "print", name: "Stickers / étiquettes", color: "#22c55e", colorsEnabled: false, maxColors: 0, minQty: 50,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45, description: "Vinyle adhésif quadri.",
    formats: [fmt("s", "≤ 5×5 cm", 5, 5), fmt("m", "≤ 10×10 cm", 10, 10), fmt("l", "≤ 20×20 cm", 20, 20)],
    breaks: [50, 100, 250, 500, 1000, 2500],
    prices: { s: [0.6, 0.38, 0.22, 0.15, 0.1, 0.07], m: [1.1, 0.7, 0.42, 0.3, 0.2, 0.15], l: [3, 2, 1.3, 0.95, 0.7, 0.55] },
    extraColorPrices: [0, 0, 0, 0, 0, 0],
    options: [o("forme", "Découpe à la forme", "", "pct", 20), o("ext", "Vinyle extérieur + lamination", "", "pct", 30), o("crea", "Création graphique", "", "fixed", 45)],
  },
  {
    id: "rollup", universe: "print", name: "Roll-up / kakémono", color: "#6366f1", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 50, description: "Structure + visuel, housse de transport incluse.",
    formats: [fmt("85", "85×200 cm", 85, 200), fmt("100", "100×200 cm", 100, 200)],
    breaks: [1, 2, 5, 10], prices: { 85: [79, 74, 68, 62], 100: [95, 89, 82, 75] }, extraColorPrices: [0, 0, 0, 0],
    options: [o("prem", "Structure premium", "", "unit", 35), o("crea", "Création graphique", "", "fixed", 80)],
  },
  {
    id: "bache", universe: "print", name: "Bâche / banderole", color: "#14b8a6", colorsEnabled: false, maxColors: 0, minQty: 1,
    setupFee: 0, setupPerColor: 0, setupLabel: "Frais", costPct: 45, description: "PVC 510 g, ourlets et œillets.",
    formats: [fmt("1x05", "100×50 cm", 100, 50), fmt("2x1", "200×100 cm", 200, 100), fmt("3x1", "300×100 cm", 300, 100), fmt("4x1", "400×100 cm", 400, 100)],
    breaks: [1, 2, 5, 10, 25], prices: { "1x05": [25, 22, 19, 17, 15], "2x1": [55, 49, 43, 38, 34], "3x1": [79, 71, 62, 55, 49], "4x1": [99, 89, 78, 69, 62] },
    extraColorPrices: [0, 0, 0, 0, 0],
    options: [o("oeil", "Œillets tous les 50 cm", "", "unit", 6), o("micro", "Bâche micro-perforée (vent)", "", "pct", 20), o("crea", "Création graphique", "", "fixed", 60)],
  },
];

const obj = (id, ref, name, category, cost, colors, coef = 1.8) =>
  ({ id, universe: "objet", ref, name, brand: "", category, cost, coef, salePrice: null, colors, sizes: ["Unique"], sizeSurcharges: {}, image: "", notes: "" });
export const SEED_OBJECTS = [
  obj("o1", "MUG330", "Mug céramique blanc 330 ml", "Mug", 1.9, ["Blanc"], 2),
  obj("o2", "STYLO-PL", "Stylo bille plastique", "Stylo", 0.25, ["Bleu", "Noir", "Rouge", "Blanc"], 2.2),
  obj("o3", "STYLO-ME", "Stylo bille métal", "Stylo", 0.9, ["Argent", "Noir", "Bleu"], 2),
  obj("o4", "GOURDE500", "Gourde inox 500 ml", "Gourde", 4.5, ["Inox", "Noir", "Blanc", "Bleu"], 1.8),
  obj("o5", "PCLE-ME", "Porte-clés métal", "Porte-clés", 0.8, ["Argent"], 2.2),
  obj("o6", "USB16", "Clé USB 16 Go", "High-tech", 3.2, ["Noir", "Blanc"], 1.8),
  obj("o7", "CARNET-A5", "Carnet A5 couverture rigide", "Papeterie", 2.1, ["Noir", "Bleu", "Rouge"], 1.9),
  obj("o8", "LANYARD", "Tour de cou 20 mm", "Accessoire", 0.6, ["Noir", "Bleu", "Rouge", "Vert"], 2.2),
  obj("o9", "PARAPLUIE", "Parapluie golf", "Accessoire", 6.5, ["Noir", "Bleu marine", "Rouge"], 1.7),
];
