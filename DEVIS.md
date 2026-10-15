# Outil Devis & BAT

Back-office : `http://localhost:4242/devis/` (mot de passe = `ADMIN_PASSWORD`).
Portail client : lien secret `…/devis/client.html?t=…` généré pour chaque devis.

## Fonctionnalités
- **Références** : catalogue textile (prix d'achat, coefficient ou prix fixe, coloris, tailles, surcoûts 2XL/3XL), import CSV/Excel avec reconnaissance automatique des colonnes, export, ajustements en masse (coef, hausse fournisseur %).
- **Marquages & tarifs** : techniques (sérigraphie, broderie, DTF, flocage… modifiables), formats avec dimensions max, grilles dégressives par palier de quantité, prix par couleur supplémentaire, frais fixes (écrans, digitalisation), coût de revient pour la marge.
- **Devis** : quantités par taille, plusieurs marquages par article, format choisi automatiquement selon les dimensions saisies, cumul des quantités d'un même visuel sur plusieurs articles (frais fixes payés une fois), remises dégressives textile, remise client, frais annexes, port, acompte, TVA. Tout prix peut être forcé à la main. Marge affichée en direct (jamais visible par le client).
- Les grilles sont **figées** dans chaque devis à sa création (« Actualiser tarifs » pour réappliquer les grilles actuelles).
- **Envoi** : lien client, email pré-rempli (ou envoi direct si SMTP configuré), suivi « vu par le client ».
- **Espace client** : consultation, PDF, acceptation avec signature électronique, refus, messagerie avec envoi de logos, paiement de l'acompte (Stripe, optionnel).
- **BAT** : dépôt d'images/PDF ou maquette créée dans l'outil (logo placé sur la photo du textile), versions successives, validation par le client avec points de contrôle + signature, ou demande de modification commentée.
- **Tableau de bord** : montants en attente, CA signé, taux de transformation, BAT en attente, liste « À traiter » (relances, BAT à préparer, production à lancer).
- **Simulateur** : prix unitaires dégressifs pour une configuration, conversion en devis en un clic.
- Sauvegarde / restauration JSON de toutes les données.

## Données
Fichiers `data/devis-*.json` et fichiers dans `uploads/`. Le calcul (`public/devis/pricing.js`) est partagé entre navigateur et serveur ; le serveur recalcule à chaque enregistrement.
