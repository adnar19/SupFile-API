import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Extraction du token (Cookie ou Header)
    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
       return res.status(401).json({ valid: false, message: "Vous n'êtes pas connecté" });
    }

    // 2. Vérification du JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 3. Recherche de l'utilisateur dans la base
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.userId || decoded.id }, 
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerified: true
      }
    });

    if (!currentUser) {
      return res.status(401).json({ valid: false, message: "L'utilisateur n'existe plus" });
    }

    // 4. Vérification du statut du compte
    if (!currentUser.isActive) {
      return res.status(403).json({ valid: false, message: "Votre compte a été désactivé" });
    }

    // On injecte l'user dans la requête et on passe à la suite
    req.user = currentUser;
    next();
  } catch (error) {
    // Si jwt.verify échoue (expiration ou mauvais secret), on arrive ici
    console.error("Erreur Auth Middleware:", error.message);
    return res.status(401).json({ valid: false, message: "Session invalide ou expirée" });
  }
};