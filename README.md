# 1. Générer le client Prisma
npm run db:generate

# 2. Créer la première migration
npm run db:migrate init

# 3. Lancer le serveur en mode développement
npm run dev

// Relations pour la table users
  files             File[]
  folders           Folder[]
  sessions          Session[]
  publicShares      PublicShare[]
  sharesCreated     InternalShare[] @relation("SharedBy")
  sharesReceived    InternalShare[] @relation("SharedWith")
  notifications     Notification[]
  activityLogs      ActivityLog[]
  tags              Tag[]

// Relations pour la table folders
  files       File[]
  publicShares     PublicShare[]
  internalShares   InternalShare[]

  # Envoyer l'email de vérification 
  Utilise Resend (recommandé) - 3000 emails/mois gratuits