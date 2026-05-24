# 📁 SupFile - Backend API

Bienvenue sur le backend de **SupFile**, une application de stockage cloud (type Google Drive) permettant la gestion de fichiers, de dossiers et l'authentification sécurisée.

Ce projet est construit avec **Node.js**, **Express**, et **PostgreSQL** (via **Prisma**).

## 🚀 Fonctionnalités

### 🔐 Authentification & Utilisateurs
- **Inscription/Connexion** : Email/Mot de passe et **Google OAuth** (via Firebase).
- **Sécurité** : Tokens JWT stockés dans des cookies `HttpOnly` sécurisés.
- **Gestion de compte** : Vérification d'email, réinitialisation de mot de passe, mise à jour du profil (avatar, thème).
- **Quotas** : Gestion de l'espace de stockage (limite par défaut à 30 Go).

### 📂 Gestion de Fichiers & Dossiers
- **Upload** : Chargement de fichiers avec vérification de quota.
- **Arborescence** : Création de dossiers, sous-dossiers et navigation type "Fil d'Ariane" (Breadcrumbs).
- **Actions** : Renommer, Déplacer (Drag & Drop supporté côté API), Supprimer (Soft delete).
- **Corbeille** : Restauration de fichiers/dossiers ou suppression définitive.
- **Téléchargement** : Fichiers individuels ou dossiers complets (génération de ZIP à la volée).
- **Prévisualisation** : Support pour l'affichage direct (images, PDF, streaming vidéo).

### 📊 Dashboard & Recherche
- **Tableau de bord** : Statistiques d'utilisation, graphique de répartition (Images/Vidéos/Docs), fichiers récents.
- **Recherche Avancée** : Recherche insensible à la casse avec filtres (Type de fichier, Date de création).

---

## 🛠️ Stack Technique

- **Runtime** : Node.js
- **Framework** : Express.js
- **Base de données** : PostgreSQL
- **ORM** : Prisma
- **Auth** : Firebase Admin (pour Google) & JWT
- **Documentation** : Swagger UI

### 📦 Packages Installés (Dépendances)
Voici les bibliothèques principales utilisées dans ce projet :

- **Serveur** : `express`, `cors`, `cookie-parser`, `express-rate-limit` (sécurité anti-brute-force)
- **Base de données** : `prisma` (CLI), `@prisma/client` (Runtime)
- **Authentification** : `bcrypt` (hashage), `jsonwebtoken`, `firebase-admin` (Google Auth)
- **Fichiers** : `multer` (upload), `archiver` (génération de ZIP)
- **Utilitaire** : `node-cron` (tâches planifiées/nettoyage)
- **Documentation** : `swagger-jsdoc`, `swagger-ui-express`

---

## ⚙️ Installation et Configuration

### 1. Prérequis
- Node.js (v18+)
- PostgreSQL installé et lancé localement.

### 2. Installation des dépendances
```bash
cd backend
npm install
```

### 3. Configuration de l'environnement (.env)
Crée un fichier `.env` à la racine du dossier `backend` et remplis-le avec tes informations :

```env
PORT=3000
# URL de connexion PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/supfile?schema=public"

# Secret pour signer les JWT
JWT_SECRET="ton_secret_super_securise"

# Configuration pour l'envoi d'emails (Resend, SendGrid, etc.)
# ... (voir email.service.js)

# Chemin vers le fichier de clé de service Firebase (pour Google Auth)
GOOGLE_APPLICATION_CREDENTIALS="./path/to/firebase-service-account.json"
```

### 4. Base de données (Prisma)

Générer le client Prisma (à faire après chaque modification du `schema.prisma`) :
```bash
npm run db:generate
```

Créer la première migration et synchroniser la DB :
```bash
npm run db:migrate init
```
*Note : Assure-toi que l'extension `pg_trgm` est activée sur ton instance Postgres pour la recherche.*

---

## ▶️ Lancer le projet

Pour lancer le serveur en mode développement (avec rechargement automatique) :

```bash
npm run dev
```

Le serveur sera accessible sur `http://localhost:3000`.

---

## 📚 Documentation API

Une documentation complète des endpoints est disponible via Swagger une fois le serveur lancé :

👉 **http://localhost:3000/docs**

---