# On part d'une image Node.js stable
FROM node:20-alpine

# Dossier de travail dans le container
WORKDIR /app

# On copie les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# On installe les dépendances
RUN npm install

# On génère le client Prisma (crucial !)
RUN npx prisma generate

# On copie le reste du code
COPY . .

# On expose le port 3000
EXPOSE 3000

# Commande de lancement
CMD ["npm", "start"]