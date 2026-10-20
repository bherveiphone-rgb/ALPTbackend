/* Boutique club : les membres choisissent leurs articles, tailles et personnalisation, puis paient. */
import { h, $, $$, icon, toast, fail, fmtEUR, fmtDate } from "./ui.js";

const params = new URLSearchParams(location.search);
const TOKEN = params.get("b") || "";
const root = $("#root");
let B = null;
const cart = [];

async function call(method, url, body) {
  const r = await fetch(`/api/devis/public/shop/${encodeURIComponent(TOKEN)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

function render() {
  const co = B.company;
  document.title = `${B.title} — boutique`;
  root.innerHTML = `<div class="head"><div class="wrap">${co.logo ? `<img src="${h(co.logo)}" alt="">` : ""}<div><h1>${h(B.title)}</h1>
    <p>${h(B.intro || "Commandez votre tenue personnalisée en quelques clics.")}${B.deadline ? ` · Commandes jusqu'au <b>${fmtDate(B.deadline)}</b>` : ""}</p></div></div></div>
  <div class="wrap" id="shopMain" style="margin-top:-46px">
    ${B.open ? "" : `<div class="card empty"><b>Les commandes sont closes.</b><p>Contactez ${h(B.title)} pour toute question.</p></div>`}
    <div class="prods">${B.products.map(p => `<div class="card prod" data-p="${h(p.id)}">
      <div class="img">${p.image ? `<img src="${h(p.image)}" alt="">` : icon("shirt")}</div>
      <div class="card-b stack" style="flex:1">
        <div><b>${h(p.name)}</b>${p.description ? `<br><small class="muted">${h(p.description)}</small>` : ""}</div>
        <div class="price">${fmtEUR(p.price)} <small class="muted" style="font-size:12px;font-weight:500">TTC</small></div>
        ${p.colors.length > 1 ? `<label class="f"><span>Couleur</span><select data-color>${p.colors.map(c => `<option>${h(c)}</option>`).join("")}</select></label>` : ""}
        <div class="row" style="flex-wrap:nowrap">
          ${p.sizes.length ? `<label class="f" style="flex:1"><span>Taille</span><select data-size><option value="">Choisir…</option>${p.sizes.map(s => `<option>${h(s)}</option>`).join("")}</select></label>` : ""}
          <label class="f" style="width:80px"><span>Qté</span><input type="number" min="1" value="1" data-qty></label></div>
        ${p.persoName || p.persoNumber ? `<div class="row" style="flex-wrap:nowrap">${p.persoName ? `<label class="f" style="flex:1"><span>Nom à floquer</span><input type="text" maxlength="20" data-pname></label>` : ""}${p.persoNumber ? `<label class="f" style="width:90px"><span>Numéro</span><input type="text" inputmode="numeric" maxlength="3" data-pnum></label>` : ""}</div>
          ${p.persoPrice ? `<small class="muted">Personnalisation : +${fmtEUR(p.persoPrice)}</small>` : ""}` : ""}
        <button class="btn primary" data-add ${B.open ? "" : "disabled"} style="margin-top:auto">${icon("plus", "sm")} Ajouter au panier</button>
      </div></div>`).join("")}</div>
    <form class="card" id="cartBox" style="margin-top:20px" novalidate></form>
  </div>`;
  $$("[data-p]").forEach(el => {
    const p = B.products.find(x => x.id === el.dataset.p);
    $("[data-add]", el).onclick = () => {
      const size = p.sizes.length ? $("[data-size]", el).value : "Unique";
      if (!size) return fail("Choisissez une taille.");
      const qty = Math.max(1, parseInt($("[data-qty]", el).value, 10) || 1);
      const persoName = $("[data-pname]", el)?.value.trim() || "", persoNumber = $("[data-pnum]", el)?.value.replace(/\D/g, "") || "";
      const unit = p.price + ((persoName || persoNumber) ? p.persoPrice : 0);
      cart.push({ productId: p.id, name: p.name, size, color: $("[data-color]", el)?.value || p.colors[0] || "", qty, persoName, persoNumber, unit });
      toast("Ajouté au panier"); drawCart();
      $("#cartBox").scrollIntoView({ behavior: "smooth" });
    };
  });
  drawCart();
}

function drawCart() {
  const total = cart.reduce((s, i) => s + i.unit * i.qty, 0);
  const box = $("#cartBox");
  if (!cart.length) { box.innerHTML = `<div class="card-b muted">Votre panier est vide : choisissez vos articles ci-dessus.</div>`; return; }
  const pay = B.payment === "both" && B.onlineAvailable;
  box.innerHTML = `<div class="card-h"><h2>${icon("card")} Votre commande</h2><b class="num">${fmtEUR(total)} TTC</b></div><div class="card-b">
    ${cart.map((i, k) => `<div class="cart-line"><span style="flex:1"><b>${i.qty} × ${h(i.name)}</b> — ${h(i.size)}${i.color ? ` · ${h(i.color)}` : ""}${i.persoName || i.persoNumber ? ` · <i>${h([i.persoName, i.persoNumber].filter(Boolean).join(" n°"))}</i>` : ""}</span><span class="num">${fmtEUR(i.unit * i.qty)}</span><button type="button" class="btn sm ghost icon" data-rm="${k}">${icon("x", "sm")}</button></div>`).join("")}
    <div class="grid g3" style="margin-top:14px"><label class="f"><span>Nom et prénom *</span><input type="text" id="on" autocomplete="name"></label>
      <label class="f"><span>Email *</span><input type="email" id="oe" autocomplete="email"></label><label class="f"><span>Téléphone</span><input type="tel" id="op" autocomplete="tel"></label></div>
    <label class="f" style="margin-top:10px"><span>Remarque</span><input type="text" id="onote" placeholder="Ex. : pour mon fils (catégorie U13)"></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    ${pay ? `<div class="row" style="margin-top:12px"><label class="check"><input type="radio" name="pm" value="online" checked> Payer maintenant par carte</label><label class="check"><input type="radio" name="pm" value="onsite"> Payer auprès du club</label></div>` : ""}
    <div class="row end" style="margin-top:14px"><button class="btn primary lg" id="go">${icon("send")} ${B.payment === "online" || pay ? "Commander et payer" : "Valider ma commande"}</button></div>
    ${B.payment === "onsite" || !B.onlineAvailable ? `<p class="hint" style="text-align:right">Paiement à effectuer auprès de ${h(B.title)}.</p>` : `<p class="hint" style="text-align:right">Paiement sécurisé par carte (Stripe).</p>`}
  </div>`;
  $$("[data-rm]", box).forEach(b => b.onclick = () => { cart.splice(+b.dataset.rm, 1); drawCart(); });
  $("#go", box).onclick = async e => {
    e.preventDefault();
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await call("POST", "/order", { name: $("#on").value, email: $("#oe").value, phone: $("#op").value, note: $("#onote").value, items: cart,
        payMode: $("[name=pm]:checked")?.value, website: $('[name="website"]').value });
      if (r.payUrl) { location.href = r.payUrl; return; }
      done(r.number, false);
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

function done(number, paid) {
  $("#shopMain").innerHTML = `<div class="card ok" style="margin-top:20px;text-align:center;padding:50px 24px"><div class="big" style="width:70px;height:70px;border-radius:50%;background:var(--success-50);color:var(--success);display:grid;place-items:center;margin:0 auto 16px">${icon("check")}</div>
    <h1>Merci, votre commande ${h(number)} est enregistrée !</h1><p class="muted">${paid ? "Votre paiement est confirmé. " : ""}Vous recevrez un email récapitulatif. La commande sera remise par ${h(B.title)}.</p></div>`;
}

(async () => {
  try {
    if (!TOKEN) throw new Error("Lien incomplet.");
    B = await call("GET", "");
    render();
    if (params.get("paid") && params.get("o")) {
      try { const r = await call("POST", "/confirm", { orderId: params.get("o"), sessionId: params.get("paid") }); done(r.number, true); }
      catch (e) { fail(e); }
      history.replaceState(null, "", `?b=${encodeURIComponent(TOKEN)}`);
    }
  } catch (e) { root.innerHTML = `<div class="empty" style="padding-top:100px">${h(e.message)}</div>`; }
})();
