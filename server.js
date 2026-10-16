import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createDevisRouter } from "./devis.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR / UPLOADS_DIR : à placer sur un disque permanent chez l'hébergeur
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

// La clé SECRÈTE ne doit JAMAIS être exposée au client. On la lit depuis .env
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

const app = express();
// Derrière un hébergeur / proxy (Render, OVH, Nginx…) : TRUST_PROXY=1 pour connaître la vraie IP des visiteurs
if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(cors());
// Outil Devis & BAT : back-office sur /devis/, portail client sur /devis/client.html
// (monté avant le parseur JSON global : il accepte des fichiers BAT plus lourds)
app.use("/api/devis", createDevisRouter({ dataDir: DATA_DIR, uploadsDir: UPLOADS_DIR, adminPassword: ADMIN_PASSWORD, stripe }));
app.use("/devis", express.static(path.join(__dirname, "public", "devis")));
app.use(express.json({ limit: "8mb" })); // marge pour l'upload d'images en base64
app.use("/uploads", express.static(UPLOADS_DIR)); // sert les photos produits

/* ============================================================
   PERSISTANCE (fichiers JSON — simple, sans base de données)
   ============================================================ */
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(SEED_PRODUCTS, null, 2));
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");
}
const readJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
// Normalise les photos : tout produit expose un tableau `images` (la 1ère = couverture).
// Compatibilité avec un éventuel ancien champ `image` (string).
const getProducts = () => readJSON(PRODUCTS_FILE).map(({ image, ...p }) => ({
  ...p,
  images: Array.isArray(p.images) ? p.images : (image ? [image] : []),
}));
const saveProducts = p => writeJSON(PRODUCTS_FILE, p);
const getOrders = () => readJSON(ORDERS_FILE);
const saveOrders = o => writeJSON(ORDERS_FILE, o);

/* ============================================================
   CATALOGUE INITIAL (semence au premier démarrage)
   Prix en EUROS. Stock par taille.
   ============================================================ */
const stk = (sizes, n) => Object.fromEntries(sizes.map(s => [s, n]));
const SEED_PRODUCTS = [
  { id:"sw1", cat:"sportswear", catLabel:"Sportswear", name:"T-shirt Club Performance", desc:"Coton bio respirant, logo brodé du club.", price:34.90, icon:"tshirt", sizes:["XS","S","M","L","XL"], stock:stk(["XS","S","M","L","XL"],25) },
  { id:"sw2", cat:"sportswear", catLabel:"Sportswear", name:"Sweat à capuche Élan", desc:"Molleton premium, coupe unisexe.", price:59.90, icon:"jacket", sizes:["S","M","L","XL"], badge:"Best-seller", stock:stk(["S","M","L","XL"],18) },
  { id:"sw3", cat:"sportswear", catLabel:"Sportswear", name:"Short d'entraînement", desc:"Tissu stretch léger, poches zippées.", price:29.90, icon:"short", sizes:["S","M","L","XL"], stock:stk(["S","M","L","XL"],30) },
  { id:"sw4", cat:"sportswear", catLabel:"Sportswear", name:"Veste survêtement", desc:"Coupe-vent fin, bandes réfléchissantes.", price:74.90, icon:"jacket", sizes:["S","M","L","XL"], stock:stk(["S","M","L","XL"],12) },
  { id:"ru1", cat:"running", catLabel:"Running", name:"Maillot Running Aero", desc:"Mesh ultra-léger, séchage rapide.", price:44.90, icon:"tshirt", sizes:["XS","S","M","L","XL"], badge:"Nouveau", stock:stk(["XS","S","M","L","XL"],20) },
  { id:"ru2", cat:"running", catLabel:"Running", name:"Short Split Race", desc:"Fentes latérales, ceinture confort.", price:39.90, icon:"short", sizes:["S","M","L","XL"], stock:stk(["S","M","L","XL"],22) },
  { id:"ru3", cat:"running", catLabel:"Running", name:"Chaussures Tempo X", desc:"Amorti réactif, drop 6 mm.", price:129.90, icon:"shoe", sizes:["40","41","42","43","44","45"], stock:stk(["40","41","42","43","44","45"],8) },
  { id:"ru4", cat:"running", catLabel:"Running", name:"Casquette Trail", desc:"Visière souple, anti-UV.", price:24.90, icon:"cap", sizes:["Unique"], stock:stk(["Unique"],40) },
  { id:"na1", cat:"natation", catLabel:"Natation", name:"Combinaison Compétition", desc:"Compression hydrodynamique homologuée.", price:159.90, icon:"suit", sizes:["S","M","L","XL"], badge:"Pro", stock:stk(["S","M","L","XL"],6) },
  { id:"na2", cat:"natation", catLabel:"Natation", name:"Lunettes Hydro Vision", desc:"Anti-buée, large champ de vision.", price:34.90, icon:"goggles", sizes:["Unique"], stock:stk(["Unique"],35) },
  { id:"na3", cat:"natation", catLabel:"Natation", name:"Bonnet Silicone Club", desc:"Silicone premium aux couleurs du club.", price:14.90, icon:"cap", sizes:["Unique"], stock:stk(["Unique"],50) },
  { id:"na4", cat:"natation", catLabel:"Natation", name:"Maillot Entraînement", desc:"Résistant au chlore, séchage rapide.", price:49.90, icon:"suit", sizes:["S","M","L","XL"], stock:stk(["S","M","L","XL"],15) },
  { id:"tr1", cat:"triathlon", catLabel:"Triathlon", name:"Trifonction Race", desc:"Une pièce natation-vélo-course, peau de chamois.", price:189.90, icon:"wetsuit", sizes:["S","M","L","XL"], badge:"Best-seller", stock:stk(["S","M","L","XL"],10) },
  { id:"tr2", cat:"triathlon", catLabel:"Triathlon", name:"Combinaison Néoprène", desc:"Néoprène 3-5 mm, flottabilité optimisée.", price:249.90, icon:"wetsuit", sizes:["S","M","L","XL"], stock:stk(["S","M","L","XL"],5) },
  { id:"tr3", cat:"triathlon", catLabel:"Triathlon", name:"Ceinture porte-dossard", desc:"Élastique, porte-gels intégrés.", price:19.90, icon:"short", sizes:["Unique"], stock:stk(["Unique"],45) },
  { id:"tr4", cat:"triathlon", catLabel:"Triathlon", name:"Lunettes Open Water", desc:"Verres polarisés, vision périphérique.", price:44.90, icon:"goggles", sizes:["Unique"], stock:stk(["Unique"],28) },
];

ensureStore();

/* ============================================================
   AUTH ADMIN (mot de passe partagé via en-tête x-admin-password)
   Suffisant pour une démo ; voir README pour durcir en production.
   ============================================================ */
function requireAdmin(req, res, next) {
  if (req.get("x-admin-password") === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: "Non autorisé" });
}

app.post("/api/admin/login", (req, res) => {
  if (req.body?.password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: "Mot de passe incorrect" });
});

/* ============================================================
   API PUBLIQUE — produits (consommée par la boutique)
   ============================================================ */
app.get("/api/products", (_req, res) => res.json(getProducts()));

/* ============================================================
   API ADMIN — upload de photo produit
   Reçoit une image en base64 (data URL), l'enregistre dans /uploads
   et renvoie son chemin. On ne fait jamais confiance au type déclaré :
   on valide l'en-tête data:image/... avant d'écrire.
   ============================================================ */
app.post("/api/upload", requireAdmin, (req, res) => {
  try {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(req.body?.dataUrl || "");
    if (!m) return res.status(400).json({ error: "Format invalide (PNG, JPG, WEBP ou GIF attendu)." });
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: "Image trop lourde (max 6 Mo)." });
    const file = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "." + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
    res.json({ url: "/uploads/" + file });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   API ADMIN — produits (CRUD)
   ============================================================ */
app.post("/api/products", requireAdmin, (req, res) => {
  const products = getProducts();
  const p = req.body;
  if (!p.name || !p.cat || typeof p.price !== "number") {
    return res.status(400).json({ error: "Champs requis : name, cat, price" });
  }
  p.id = p.id || (p.cat.slice(0, 2) + Date.now().toString(36));
  p.sizes = p.sizes?.length ? p.sizes : ["Unique"];
  p.stock = p.stock || stk(p.sizes, 0);
  products.push(p);
  saveProducts(products);
  res.json(p);
});

app.put("/api/products/:id", requireAdmin, (req, res) => {
  const products = getProducts();
  const i = products.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Produit introuvable" });
  products[i] = { ...products[i], ...req.body, id: products[i].id };
  saveProducts(products);
  res.json(products[i]);
});

app.delete("/api/products/:id", requireAdmin, (req, res) => {
  let products = getProducts();
  if (!products.some(p => p.id === req.params.id)) {
    return res.status(404).json({ error: "Produit introuvable" });
  }
  products = products.filter(p => p.id !== req.params.id);
  saveProducts(products);
  res.json({ ok: true });
});

// Mise à jour rapide du stock { stock: { S: 10, M: 5 } }
app.patch("/api/products/:id/stock", requireAdmin, (req, res) => {
  const products = getProducts();
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Produit introuvable" });
  p.stock = { ...p.stock, ...req.body.stock };
  saveProducts(products);
  res.json(p);
});

/* ============================================================
   API ADMIN — commandes
   ============================================================ */
const STATUSES = ["en_attente", "payee", "preparation", "expediee", "livree", "annulee"];

app.get("/api/orders", requireAdmin, (_req, res) => {
  res.json(getOrders().sort((a, b) => b.createdAt - a.createdAt));
});

app.patch("/api/orders/:id", requireAdmin, (req, res) => {
  const orders = getOrders();
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: "Commande introuvable" });
  if (req.body.status && !STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: "Statut invalide" });
  }
  if (req.body.status) o.status = req.body.status;
  saveOrders(orders);
  res.json(o);
});

/* ============================================================
   API ADMIN — statistiques tableau de bord
   ============================================================ */
app.get("/api/stats", requireAdmin, (_req, res) => {
  const orders = getOrders();
  const products = getProducts();
  const paid = orders.filter(o => o.status !== "en_attente" && o.status !== "annulee");

  const revenue = paid.reduce((s, o) => s + o.total, 0); // centimes
  const byCat = {};
  const byProduct = {};
  for (const o of paid) {
    for (const it of o.items) {
      byProduct[it.name] = (byProduct[it.name] || 0) + it.qty;
      const prod = products.find(p => p.id === it.id);
      const cat = prod?.catLabel || "Autre";
      byCat[cat] = (byCat[cat] || 0) + it.price * it.qty;
    }
  }
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lowStock = [];
  for (const p of products) {
    for (const [size, q] of Object.entries(p.stock || {})) {
      if (q <= 5) lowStock.push({ id: p.id, name: p.name, size, qty: q });
    }
  }

  res.json({
    revenue,
    ordersCount: paid.length,
    pendingCount: orders.filter(o => o.status === "payee").length,
    avgBasket: paid.length ? Math.round(revenue / paid.length) : 0,
    productCount: products.length,
    salesByCategory: byCat,
    topProducts,
    lowStock: lowStock.sort((a, b) => a.qty - b.qty).slice(0, 8),
    recentOrders: paid.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  });
});

/* ============================================================
   PAIEMENT — création du PaymentIntent + commande
   ============================================================ */
function priceCents(euros) { return Math.round(euros * 100); }

app.post("/create-payment-intent", async (req, res) => {
  try {
    const { items, email, name, address } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Panier vide ou invalide.");
    }
    const products = getProducts();
    let total = 0;
    const orderItems = [];
    const summary = [];

    for (const item of items) {
      const product = products.find(p => p.id === item.id);
      const qty = Number.parseInt(item.qty, 10);
      if (!product) throw new Error(`Produit inconnu : ${item.id}`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
        throw new Error(`Quantité invalide pour ${item.id}`);
      }
      const available = product.stock?.[item.size] ?? 0;
      if (available < qty) {
        throw new Error(`Stock insuffisant : ${product.name} (${item.size}) — ${available} restant(s)`);
      }
      total += priceCents(product.price) * qty;
      orderItems.push({ id: product.id, name: product.name, size: item.size, qty, price: product.price });
      summary.push(`${qty}× ${product.name} (${item.size})`);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      description: "Boutique Élan Club",
      metadata: { contenu: summary.join(", ") },
    });

    // Enregistrement de la commande en attente de paiement
    const orders = getOrders();
    const order = {
      id: "CMD-" + Date.now().toString(36).toUpperCase(),
      createdAt: Date.now(),
      email: email || "", name: name || "", address: address || "",
      items: orderItems, total, status: "en_attente",
      paymentIntentId: paymentIntent.id,
    };
    orders.push(order);
    saveOrders(orders);

    res.json({ clientSecret: paymentIntent.client_secret, orderId: order.id });
  } catch (err) {
    console.error("Erreur paiement:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Confirmation après paiement réussi : marque la commande payée + décrémente le stock
app.post("/confirm-order", (req, res) => {
  const orders = getOrders();
  const order = orders.find(o => o.id === req.body.orderId);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if (order.status === "en_attente") {
    order.status = "payee";
    const products = getProducts();
    for (const it of order.items) {
      const p = products.find(x => x.id === it.id);
      if (p && p.stock && typeof p.stock[it.size] === "number") {
        p.stock[it.size] = Math.max(0, p.stock[it.size] - it.qty);
      }
    }
    saveProducts(products);
    saveOrders(orders);
  }
  res.json({ ok: true, status: order.status });
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.redirect("/devis/"));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Backend Élan Club sur http://localhost:${PORT}`);
  console.log(`   Boutique  : http://localhost:3000/index.html`);
  console.log(`   Back office: http://localhost:3000/admin.html`);
  console.log(`   Devis & BAT: http://localhost:${PORT}/devis/`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("⚠️  STRIPE_SECRET_KEY manquante — créez un fichier .env (voir .env.example)");
  }
  if (ADMIN_PASSWORD === "admin") {
    console.warn("⚠️  Mot de passe admin par défaut « admin » — définissez ADMIN_PASSWORD dans .env");
  }
});
