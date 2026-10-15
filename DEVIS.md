# Atelier — Devis, BAT, CRM, production et prospection

Back-office : `http://localhost:4242/devis/` (mot de passe = `ADMIN_PASSWORD`).
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

Fichiers `data/devis-*.json` (une collection par fichier, écriture atomique) et fichiers dans `uploads/`. Sauvegardez ces deux dossiers ; un export complet (sans mots de passe) est disponible dans Paramètres › Sauvegarde.

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
| `modules/store.js`, `core.js`, `seeds.js` | Stockage, utilitaires partagés, valeurs par défaut |

Le planificateur (toutes les minutes) lance les automatisations (10 min), relève les emails (3 min), synchronise Pennylane (30 min) et envoie les campagnes au rythme défini. `DISABLE_SCHEDULER=1` le désactive.
