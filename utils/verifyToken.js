import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';

/**
 * Middleware pour protéger les routes
 * Vérifie le JWT et attache l'utilisateur à req.user
 */
export const protect = async (req, res, next) => {
  try {
    // 1. Extraire le token
    let token;
    
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      throw ErrorTypes.Unauthorized('Please log in to access this resource');
    }

    // 2. Vérifier le token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw ErrorTypes.Unauthorized('Your session has expired. Please log in again');
      }
      throw ErrorTypes.Unauthorized('Invalid token. Please log in again');
    }

    // 3. Vérifier que la session existe et est active
    const session = await prisma.session.findFirst({
      where: {
        token,
        userId: decoded.id,
        isActive: true,
      }
    });

    if (!session) {
      throw ErrorTypes.Unauthorized('Session not found or expired. Please log in again');
    }

    // 4. Vérifier que la session n'a pas expiré
    if (new Date() > new Date(session.expiresAt)) {
      // Invalider la session expirée
      await prisma.session.update({
        where: { id: session.id },
        data: { isActive: false }
      });
      
      throw ErrorTypes.Unauthorized('Session expired. Please log in again');
    }

    // 5. Récupérer l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        emailVerified: true,
        passwordChangedAt: true,
      }
    });

    if (!user) {
      throw ErrorTypes.Unauthorized('User no longer exists');
    }

    // 6. Vérifier que le compte est actif
    if (!user.isActive) {
      throw ErrorTypes.Forbidden('Your account has been deactivated');
    }

    // 7. Vérifier si le mot de passe a changé après l'émission du token
    if (user.passwordChangedAt) {
      const changedTimestamp = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      
      if (decoded.iat < changedTimestamp) {
        throw ErrorTypes.Unauthorized('Password recently changed. Please log in again');
      }
    }

    // 8. Mettre à jour lastActivityAt de la session
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() }
    });

    // 9. Attacher l'utilisateur et le token à la requête
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware pour restreindre l'accès selon le rôle
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ErrorTypes.Unauthorized('Please log in to access this resource'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        ErrorTypes.Forbidden('You do not have permission to perform this action')
      );
    }
    
    next();
  };
};

/**
 * Middleware optionnel : permet l'accès sans authentification
 * mais attache l'utilisateur si un token valide est fourni
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
          }
        });
        
        if (user && user.isActive) {
          req.user = user;
          req.token = token;
        }
      } catch (error) {
        // Token invalide, mais on continue sans user
      }
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, continuer sans authentification
    next();
  }
};