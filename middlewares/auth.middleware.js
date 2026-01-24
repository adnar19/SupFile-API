import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Récupérer le token depuis les Cookies ou le Header Authorization
    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // 2. Vérifier si le token existe
    if (!token) {
      throw ErrorTypes.Unauthorized('Vous n\'êtes pas connecté pour accéder à cette ressource');
    }

    // 3. Vérifier la validité du token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. Vérifier si l'utilisateur existe toujours en base
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerified: true
      }
    });

    if (!currentUser) {
      throw ErrorTypes.Unauthorized('L\'utilisateur n\'existe plus');
    }

    // 5. Vérifier si le compte est actif
    if (!currentUser.isActive) {
      throw ErrorTypes.Forbidden('Votre compte a été désactivé');
    }

    // 6. AJOUTER L'UTILISATEUR À LA REQUÊTE
    // Cela permet aux contrôleurs suivants (ex: getCurrentUser) d'accéder à req.user.id
    req.user = currentUser;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(ErrorTypes.Unauthorized('Token invalide'));
    } else if (error.name === 'TokenExpiredError') {
      next(ErrorTypes.Unauthorized('Votre session a expiré, veuillez vous reconnecter'));
    } else {
      next(error);
    }
  }
};