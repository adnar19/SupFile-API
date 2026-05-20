import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. On récupère le token de session (Cookie pour toi, Bearer pour Adnane)
    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Si pas de token, la session est considérée comme inexistante
    if (!token) {
       return res.status(401).json({ message: "Session inexistante, veuillez vous connecter" });
    }

    // 2. On vérifie si le token est valide et non expiré
    // C'est ici que ton JWT_SECRET assure que le token vient bien de ton serveur
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 3. On récupère l'utilisateur en base pour confirmer qu'il existe toujours
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.userId || decoded.id }, 
      select: {
        id: true,
        email: true,
        isActive: true,
        storageUsed: true,
        storageQuota: true,
        // On ne prend que le nécessaire pour la session
      }
    });

    if (!currentUser) {
      return res.status(401).json({ message: "Utilisateur inconnu" });
    }

    // 4. On vérifie si le compte n'est pas bloqué
    if (!currentUser.isActive) {
      return res.status(403).json({ message: "Compte désactivé" });
    }

    // On attache l'utilisateur à la requête pour que la route /check puisse y accéder
    req.user = currentUser;
    next();

  } catch (error) {
    // Si jwt.verify échoue (token modifié ou expiré), on tombe ici
    console.error("Session invalide :", error.message);
    return res.status(401).json({ message: "Session expirée ou invalide" });
  }
};