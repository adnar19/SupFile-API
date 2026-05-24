import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Récupérer le token (Cookie, Bearer header, ou URL query)
    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      // Support du token dans l'URL pour les téléchargements directs
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ message: "Session inexistante, veuillez vous connecter" });
    }

    // 2. Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Récupérer l'utilisateur
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.userId || decoded.id },
      select: {
        id: true,
        email: true,
        isActive: true,
        storageUsed: true,
        storageQuota: true,
      }
    });

    if (!currentUser) {
      return res.status(401).json({ message: "Utilisateur inconnu" });
    }

    if (!currentUser.isActive) {
      return res.status(403).json({ message: "Compte désactivé" });
    }

    req.user = currentUser;
    next();

  } catch (error) {
    console.error("Session invalide:", error.message);
    return res.status(401).json({ message: "Session expirée ou invalide" });
  }
};
