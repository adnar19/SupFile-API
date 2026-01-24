import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { validateSignupData, validateSigninData } from '../utils/validator.js';
import { 
  createVerificationToken, 
  sendVerificationEmail,
  verifyAndConsumeToken 
} from '../services/email.service.js';
import jwt from 'jsonwebtoken';

// ============================================
// SIGNUP (Inscription manuelle - Email/Password)
// ============================================

export const signup = async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;

    // 1. Valider
    validateSignupData({ email, password, fullName });

    // 2. Vérifier si existe
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      throw ErrorTypes.Conflict('Cet email est déjà utilisé');
    }

    // 3. Hasher password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 4. Créer utilisateur (emailVerified = false, isActive = false)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: fullName?.trim() || null,
        emailVerified: false,  // ✅ Pas vérifié par défaut
        isActive: false,       // ✅ Pas actif tant que l'email n'est pas vérifié
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        theme: true,
        emailVerified: true,
        isActive: true,
        storageUsed: true,
        storageQuota: true,
        createdAt: true,
      }
    });

    // 5. Créer dossier racine
    await prisma.folder.create({
      data: {
        name: 'My Files',
        ownerId: user.id,
        path: '/My Files'
      }
    });

    // 6. Créer token de vérification
    const verificationToken = await createVerificationToken(user.id, user.email);

    // 7. Envoyer email
    await sendVerificationEmail(user.email, verificationToken, user.fullName);

    // 8. Logger
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'user.signup',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          email: user.email,
          method: 'email',
          emailVerified: false,
          isActive: false
        }
      }
    });

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Compte créé avec succès. Veuillez vérifier votre email pour activer votre compte.',
      data: {
        user: {
          ...user,
          storageUsed: Number(user.storageUsed),
          storageQuota: Number(user.storageQuota),
        },
        emailVerificationRequired: true
      }
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// SIGNIN (Connexion manuelle - Email/Password)
// ============================================

export const signin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Valider
    validateSigninData({ email, password });

    // 2. Trouver utilisateur
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      throw ErrorTypes.Unauthorized('Email ou mot de passe incorrect');
    }

    // 3. Vérifier si compte OAuth
    if (user.oauthProvider) {
      throw ErrorTypes.Unauthorized(
        `Ce compte est connecté via ${user.oauthProvider}. Veuillez vous connecter via ${user.oauthProvider}.`
      );
    }

    // 4. ✅ VÉRIFIER SI L'EMAIL EST VÉRIFIÉ
    if (!user.emailVerified) {
      throw ErrorTypes.Forbidden(
        'Votre email n\'est pas encore vérifié. Veuillez vérifier votre boîte mail.'
      );
    }

    // 5. Vérifier compte actif
    if (!user.isActive) {
      throw ErrorTypes.Forbidden(
        'Votre compte n\'est pas activé. Veuillez contacter le support.'
      );
    }

    // 6. Vérifier password
    if (!user.password) {
      throw ErrorTypes.Unauthorized('Mot de passe non défini pour ce compte');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw ErrorTypes.Unauthorized('Email ou mot de passe incorrect');
    }

    // 7. Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // 8. Logger
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'user.signin',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          email: user.email,
          method: 'email'
        }
      }
    });

    // 9. Générer JWT
    const token = jwt.sign(
      { 
        id: user.id,
        email: user.email,
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 10. Préparer les données utilisateur (sans le password)
    const { password: _, ...userInfo } = user;

    // 11. Cookie settings
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 heures
    };

    res.cookie('access_token', token, cookieOptions)
      .status(200)
      .json({
        success: true,
        statusCode: 200,
        message: 'Connexion réussie',
        data: {
          user: {
            ...userInfo,
            storageUsed: Number(userInfo.storageUsed),
            storageQuota: Number(userInfo.storageQuota),
          },
          token
        }
      });

  } catch (error) {
    next(error);
  }
};

// ============================================
// FIREBASE OAUTH CALLBACK
// ============================================

export const firebaseOAuthCallback = async (req, res, next) => {
  try {
    const { firebaseToken, provider } = req.body;

    if (!firebaseToken) {
      throw ErrorTypes.ValidationError('Firebase token requis');
    }

    if (!['google', 'microsoft', 'github'].includes(provider?.toLowerCase())) {
      throw ErrorTypes.ValidationError('Provider OAuth invalide');
    }

    // 1. Vérifier le token Firebase
    const admin = await import('firebase-admin');
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);

    const { uid, email, name, picture, email_verified } = decodedToken;

    if (!email) {
      throw ErrorTypes.ValidationError('Email requis pour l\'authentification OAuth');
    }

    // 2. Chercher utilisateur existant par OAuth
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: provider.toLowerCase(),
        oauthId: uid
      }
    });

    const isNewUser = !user;

    // 3. Si pas trouvé, chercher par email
    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      // Si trouvé par email mais c'est un compte local
      if (user && user.password) {
        throw ErrorTypes.Conflict(
          'Un compte existe déjà avec cet email. Veuillez vous connecter avec votre email et mot de passe.'
        );
      }

      // Si trouvé par email mais OAuth différent
      if (user && user.oauthProvider && user.oauthProvider !== provider.toLowerCase()) {
        throw ErrorTypes.Conflict(
          `Ce compte est lié à ${user.oauthProvider}. Veuillez vous connecter via ${user.oauthProvider}.`
        );
      }

      // Lier OAuth à compte existant
      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            oauthProvider: provider.toLowerCase(),
            oauthId: uid,
            emailVerified: true,  // ✅ OAuth = email vérifié
            isActive: true,       // ✅ OAuth = compte actif
            avatarUrl: picture || user.avatarUrl,
            fullName: name || user.fullName,
          }
        });
      }
    }

    // 4. Créer nouveau compte si nécessaire
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          fullName: name || null,
          oauthProvider: provider.toLowerCase(),
          oauthId: uid,
          emailVerified: true,  // ✅ OAuth = email vérifié automatiquement
          isActive: true,       // ✅ OAuth = compte actif automatiquement
          avatarUrl: picture || null,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          theme: true,
          emailVerified: true,
          isActive: true,
          oauthProvider: true,
          storageUsed: true,
          storageQuota: true,
          avatarUrl: true,
          createdAt: true,
        }
      });

      // Créer dossier racine
      await prisma.folder.create({
        data: {
          name: 'My Files',
          ownerId: user.id,
          path: '/My Files'
        }
      });

      // Logger signup
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'user.signup',
          entityType: 'user',
          entityId: user.id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            email: user.email,
            method: 'oauth',
            provider: provider.toLowerCase(),
            emailVerified: true,
            isActive: true
          }
        }
      });
    } else {
      // Update lastLoginAt pour utilisateur existant
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // Logger signin
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'user.signin',
          entityType: 'user',
          entityId: user.id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            email: user.email,
            method: 'oauth',
            provider: provider.toLowerCase()
          }
        }
      });
    }

    // 5. Générer JWT
    const token = jwt.sign(
      { 
        id: user.id,
        email: user.email,
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 6. Cookie settings
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 heures
    };

    res.cookie('access_token', token, cookieOptions)
      .status(200)
      .json({
        success: true,
        statusCode: 200,
        message: isNewUser ? 'Compte créé avec succès' : 'Connexion réussie',
        data: {
          user: {
            ...user,
            storageUsed: Number(user.storageUsed),
            storageQuota: Number(user.storageQuota),
          },
          token,
          isNewUser
        }
      });

  } catch (error) {
    next(error);
  }
};

// ============================================
// VERIFY EMAIL
// ============================================

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token) {
      throw ErrorTypes.ValidationError('Token de vérification requis');
    }

    // 1. Vérifier et consommer le token
    const { userId } = await verifyAndConsumeToken(token);

    // 2. ✅ Marquer email comme vérifié ET activer le compte
    const user = await prisma.user.update({
      where: { id: userId },
      data: { 
        emailVerified: true,
        isActive: true  // ✅ Activer automatiquement après vérification
      },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isActive: true
      }
    });

    // 3. Logger
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'user.email_verified',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          emailVerified: true,
          isActive: true
        }
      }
    });

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Email vérifié avec succès. Votre compte est maintenant actif.',
      data: {
        emailVerified: user.emailVerified,
        isActive: user.isActive
      }
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// RESEND VERIFICATION EMAIL
// ============================================

export const resendVerificationEmail = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerified: true
      }
    });

    if (!user) {
      throw ErrorTypes.NotFound('Utilisateur non trouvé');
    }

    if (user.emailVerified) {
      throw ErrorTypes.ValidationError('Email déjà vérifié');
    }

    // Créer nouveau token
    const verificationToken = await createVerificationToken(user.id, user.email);

    // Envoyer email
    await sendVerificationEmail(user.email, verificationToken, user.fullName);

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Email de vérification renvoyé'
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// GET CURRENT USER
// ============================================

export const getCurrentUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        theme: true,
        emailVerified: true,
        isActive: true,
        oauthProvider: true,
        storageUsed: true,
        storageQuota: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: {
            folders: { where: { isDeleted: false } }
          }
        }
      }
    });

    if (!user) {
      throw ErrorTypes.NotFound('Utilisateur non trouvé');
    }

    res.status(200).json({
      success: true,
      statusCode: 200,
      data: {
        ...user,
        storageUsed: Number(user.storageUsed),
        storageQuota: Number(user.storageQuota),
        storagePercent: ((Number(user.storageUsed) / Number(user.storageQuota)) * 100).toFixed(2)
      }
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// SIGNOUT
// ============================================

export const signout = async (req, res, next) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    })
    .status(200)
    .json({
      success: true,
      statusCode: 200,
      message: 'Déconnexion réussie'
    });
  } catch (error) {
    next(error);
  }
};