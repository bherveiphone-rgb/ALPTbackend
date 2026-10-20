# Atelier — Devis, BAT, CRM, production et prospection

Back-office : `http://localhost:4242/devis/` (email vide + mot de passe `ADMIN_PASSWORD`, ou compte personnel créé dans Paramètres › Utilisateurs).
Formulaire public de demande : `/devis/demande.html` · Espace client : lien personnel `/devis/client.html?t=…`.

## Le parcours complet

```
Prospection ──► Demande ──► Devis ──► Accepté (signé) ──► BAT validé ──► Production ──► Expédié ──► Livré ──► Avis / Facture soldée
 campagnes      formulaire   calcul    espace client       espace client   tableau        n° suivi    relance     Pennylane
 annuaire       email        auto      acompte Stripe      versions        fiche atelier  email auto  réactivation
```

| Étape | Ce que fait l'outil automatiquement | Ce que vous faites |
|---|---|---|
| **Prospection** | Recherche dans l'annuaire officiel des entreprises/associations, envoie les campagnes depuis votre boîte (quota, horaires, désinscription), **arrête les relances dès qu'un prospect répond** et crée une tâche | Choisir la cible, compléter les emails, écrire/activer la campagne |
| **Demande** | Formulaire public (articles, tailles, emplacements, dimensions, logo), fiche contact créée, accusé de réception, alerte, tâche « répondre sous 24 h » | Cliquer « Créer le devis » |
| **Devis** | Pré-rempli depuis la demande (référence, tailles, technique conseillée, visuels), calcul des prix, marge, lien client | Ajuster, envoyer |
| **Suivi** | « Vu par le client », relances J+3 / J+7 (tâche ou email auto), alerte avant expiration | Relancer / appeler |
| **Acceptation** | Signature électronique, fiche passée en « client », tâche « préparer le BAT », rappel d'acompte | Préparer le BAT |
| **BAT** | Envoi, relance si pas de réponse, tâche si modification demandée, passage en production à la validation | Corriger / renvoyer |
| **Production** | Tableau glisser-déposer, email « production lancée » et « expédié » (n° de suivi), alerte si la date souhaitée approche | Avancer les cartes, imprimer la fiche de fabrication |
| **Facturation** | Factures d'acompte/solde dans Pennylane (brouillon), synchro des paiements toutes les 30 min | Valider les factures dans Pennylane |
| **Après-vente** | Demande d'avis, tâche si avis ≤ 3/5, tâche « recontacter » un client sans commande depuis 10 mois | — |

Toutes les règles se règlent dans **Paramètres › Automatisations** (délais, envoi automatique ou simple tâche).

## Les outils de l'atelier

| Écran | À quoi ça sert |
|---|---|
| **Devis › variantes et options** | Chaque ligne peut être « incluse », « en option » ou « variante » (ex. dos sérigraphié *ou* brodé). Le client coche ses choix dans son espace : le total se met à jour avant signature. |
| **Modèles de devis** | « Modèle » dans un devis pour le réutiliser ; « Depuis un modèle » dans la liste des devis. Bouton « Reconduire » sur une fiche contact pour refaire la commande de l'an dernier aux tarifs actuels. |
| **Boutiques club** | Page de commande pour les membres d'un club (tailles, nom/numéro, paiement en ligne ou au club). Les commandes sont regroupées en un devis, avec la liste des noms. |
| **Planning** | Commandes à placer sur une machine et un jour (glisser-déposer). Capacité par machine, alerte en cas de surcharge ou de date de livraison dépassée, planification automatique par échéance. |
| **Achats** | Textile à commander, regroupé par fournisseur, référence, couleur et taille, stock déduit ; envoi du bon de commande par email. Import des tarifs fournisseurs (Références › Tarif fournisseur). |
| **Stock** | Pièces d'avance et consommables, entrées/sorties/inventaire, alerte de seuil (tâche). Les pièces en stock sont retirées automatiquement au lancement du marquage. |
| **Facturation** | Paiements, factures Pennylane, rapprochement des virements **Qonto** (référence du devis ou montant + nom du client). |
| **Statistiques** | CA, marge, panier moyen, taux de transformation, CA par mois, marge par technique, par univers et par client, origine des demandes. Réservé aux administrateurs. |

### Comptes et rôles

Paramètres › Utilisateurs : un compte par personne (email + mot de passe).
- **Administrateur** : accès complet.
- **Employé** : devis, contacts, demandes, production, planning, achats, stock. Les prix d'achat, coefficients et marges ne lui sont jamais envoyés (les prix de ses devis sont calculés par le serveur) ; pas d'accès aux paramètres, tarifs, facturation ni statistiques.

### Application mobile

Ouvrez l'adresse de l'outil (l'adresse publique https du tunnel) sur votre téléphone :
- **Android / Chrome** : menu ⋮ › « Installer l'application » (ou le bouton « Installer l'application » en bas du menu) ;
- **iPhone / Safari** : bouton Partager › « Sur l'écran d'accueil ».

Dans l'onglet BAT d'un devis, « Prendre une photo » ouvre directement l'appareil photo (photo d'un premier tirage ou d'un échantillon à faire valider).

## Mise en route (15 minutes)

1. **Paramètres › Entreprise** : logo, coordonnées, IBAN, signature d'email, conditions générales.
2. **Références** : importez votre catalogue (CSV/Excel) ; **Marquages & tarifs** : remplacez les grilles d'exemple par les vôtres.
3. **Paramètres › Boîte mail** : choisissez votre fournisseur, saisissez l'adresse et le mot de passe, cochez « Lire les emails reçus », puis « Enregistrer et tester ».
   - **Gmail** : activez la validation en 2 étapes puis créez un *mot de passe d'application* (compte Google › Sécurité › Mots de passe des applications) — le mot de passe habituel ne fonctionne pas.
4. **Paramètres › Pennylane** : collez un jeton d'API v2 (Pennylane › Paramètres › Connectivité › Développeurs, droits « Factures clients » et « Clients »), puis « Enregistrer et tester ». Les factures sont créées **en brouillon** par défaut.
5. Ajoutez le lien du **formulaire de demande** sur votre site (code d'intégration dans Paramètres › Formulaire), vos réseaux et votre signature.
6. En production : renseignez `PUBLIC_URL` (liens envoyés aux clients) et `TRUST_PROXY=1` si vous êtes derrière un hébergeur.

## Prospection : alimenter la base

- **Onglet « Trouver des prospects »** : clubs, associations, écoles, BTP, restaurants… par activité (code NAF), département ou mot-clé. Les emails n'y figurent pas : complétez-les (site du club, fédération) avant de lancer une campagne.
- **Import CSV** : colonnes reconnues automatiquement (structure, contact, email, téléphone, ville, code postal, secteur, SIREN…).
- **Import automatisé** (scripts, Zapier/Make, ou listes préparées par Claude) :

```http
POST /api/devis/prospects/import
x-admin-password: <ADMIN_PASSWORD>
Content-Type: application/json

{ "source": "Ligue AURA handball 2026", "tags": ["Handball", "Rhône"],
  "items": [ { "company": "HBC Exemple", "contact": "Camille Martin", "email": "contact@hbc-exemple.fr",
               "phone": "04 00 00 00 00", "zip": "69003", "city": "Lyon", "sector": "Handball", "siren": "123456789" } ] }
```

Doublons (email/SIREN), clients existants et adresses désinscrites sont ignorés automatiquement.

**Règles B2B (RGPD / CNIL)** : adresses professionnelles uniquement, message en lien avec l'activité du destinataire, expéditeur identifiable, lien de désinscription (ajouté automatiquement, en un clic) et respect immédiat des oppositions (réponse « STOP » détectée).

## Données et sauvegarde

Fichiers `data/devis-*.json` (une collection par fichier, écriture atomique) et fichiers dans `uploads/`.

**Sauvegarde automatique** : chaque jour, une copie complète (sans mots de passe) est écrite dans `data/backups/` et, si vous l'indiquez dans Paramètres › Sauvegarde, dans un dossier synchronisé (OneDrive, Google Drive pour ordinateur, Dropbox, NAS…) avec les visuels et BAT (dossier `fichiers`). Les 30 dernières sont conservées (réglable). Si la copie échoue, une tâche vous prévient. Un export/restauration manuel reste disponible au même endroit.

Les mots de passe mail et la clé Pennylane sont stockés sur le serveur et ne sont jamais renvoyés au navigateur. Variables d'environnement possibles à la place : voir `.env.example`.

## Architecture

| Fichier | Rôle |
|---|---|
| `public/devis/pricing.js` | Moteur de calcul partagé navigateur/serveur |
| `devis.js` | Devis, BAT, espace client, paiement Stripe |
| `modules/crm.js` | Contacts, historique, tâches, demandes, formulaire public |
| `modules/workflow.js` | Production, automatisations planifiées, emails entrants |
| `modules/pennylane.js` | Factures et synchronisation Pennylane |
| `modules/prospection.js` | Prospects, annuaire, campagnes, désinscription |
| `modules/mail.js` | Envoi SMTP et lecture IMAP |
| `modules/qonto.js` | Rapprochement des virements Qonto |
| `modules/purchasing.js` | Modèles de devis, tarifs fournisseurs, commandes fournisseurs |
| `modules/shops.js` | Boutiques club (pages de commande des membres) |
| `modules/atelier.js` | Planning machines et stock |
| `modules/accounts.js` | Comptes, rôles, masquage des prix d'achat |
| `modules/insights.js` | Statistiques et sauvegarde automatique |
| `modules/store.js`, `core.js`, `seeds.js` | Stockage, utilitaires partagés, valeurs par défaut |

Le planificateur (toutes les minutes) lance les automatisations (10 min), relève les emails (3 min), synchronise Pennylane (30 min) et Qonto (15 min), fait la sauvegarde du jour et envoie les campagnes au rythme défini. `DISABLE_SCHEDULER=1` le désactive.
