import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js'; // Chemin à vérifier selon ton dossier
export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
       // Si tu as enlevé l'import de ErrorTypes, utilise une réponse classique :
       return res.status(401).json({ message: "Vous n'êtes pas connecté" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Ajoute ce log pour voir exactement ce qu'il y a dans ton token dans ton terminal
    console.log("Token décodé :", decoded);

    const currentUser = await prisma.user.findUnique({
      // On teste les deux : si userId est vide, il prendra id
      where: { id: decoded.userId || decoded.id }, 
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerified: true
      }
    });

    if (!currentUser) {
      return res.status(401).json({ message: "L'utilisateur n'existe plus" });
    }

    if (!currentUser.isActive) {
      return res.status(403).json({ message: "Votre compte a été désactivé" });
    }

    req.user = currentUser;
    next();
  } catch (error) {
    console.error("Erreur Auth Middleware:", error);
    return res.status(401).json({ message: "Session invalide ou expirée" });
  }
};