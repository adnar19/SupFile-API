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
      where: { email: email }
    });

    if (existingUser) {
      throw ErrorTypes.Conflict('cet email est déjà utilisé');
    }

    // 3. Hasher password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 4. Créer utilisateur
    const user = await prisma.user.create({
      data: {
        email: email,
        password: hashedPassword,
        fullName: fullName?.trim() || null,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        theme: true,
        emailVerified: true,
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
          emailVerified: false
        }
      }
    });

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Account created. Please check your email to verify.',
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
      where: { email: email }
    });

    if (!user) {
      throw ErrorTypes.Unauthorized('Cet email est incorrect.');
    }

    // 3. Vérifier si compte OAuth
    if (user.oauthProvider) {
      throw ErrorTypes.Unauthorized(
        `Ce compte est connecté via ${user.oauthProvider}. Veuillez vous connecter via ${user.oauthProvider}.`
      );
    }

    // 4. Vérifier compte actif
    if (!user.isActive) {
      throw ErrorTypes.Forbidden('Ce compte n\'est pas activé. Veuillez contacter le support.');
    }

    // 5. Vérifier password
    if (!user.password) {
      throw ErrorTypes.Unauthorized('Mot de passe non défini pour ce compte. ');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw ErrorTypes.Unauthorized('Mot de passe incorrect');
    }

    // 6. Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // 7. Logger
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

    // 8. signin token
    const token = jwt.sign({ 
      id: user.id,
      email: user.email,
    }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });
    // enlenver le mot de passe de la reponse de l'utilisateur
    const { password: pass, ...userInfo } = user.toJSON();

    // 9. Cookie settings
    res.cookie('token', token, {
  httpOnly: true,      // Protection XSS
  secure: true,        // HTTPS only
  sameSite: 'strict',  // Protection CSRF
  maxAge: 24 * 60 * 60 * 1000 // 24h
});

    res
     .cookie("access_token", token, cookieOptions)
      .status(200)
      .json(userInfo);
  } catch (error) {
    throw ErrorTypes.InternalError(error.message);
  }
};

// ============================================
// FIREBASE OAUTH CALLBACK
// ============================================

/**
 * Gérer l'auth Firebase OAuth
 * Le frontend envoie le Firebase ID Token après login
 */
export const firebaseOAuthCallback = async (req, res, next) => {
  try {
    const { firebaseToken, provider } = req.body;

    if (!firebaseToken) {
      throw ErrorTypes.ValidationError('Firebase token required');
    }

    // 1. Vérifier le token Firebase (via Firebase Admin SDK)
    const admin = await import('firebase-admin');
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);

    const { uid, email, name, picture, email_verified } = decodedToken;

    // 2. Chercher utilisateur existant
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: provider,
        oauthId: uid
      }
    });

    // 3. Si pas trouvé, chercher par email
    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      // Si trouvé par email, lier OAuth
      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            oauthProvider: provider,
            oauthId: uid,
            emailVerified: email_verified || true,
            avatarUrl: picture || user.avatarUrl,
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
          oauthProvider: provider,
          oauthId: uid,
          emailVerified: email_verified || true,
          avatarUrl: picture || null,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          theme: true,
          emailVerified: true,
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
            provider: provider
          }
        }
      });
    } else {
      // Update lastLoginAt
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
            provider: provider
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'OAuth authentication successful',
      data: {
        user: {
          ...user,
          storageUsed: Number(user.storageUsed),
          storageQuota: Number(user.storageQuota),
        }
      }
    });

  } catch (error) {
    throw ErrorTypes.InternalError(error.message);
  }
};

// ============================================
// VERIFY EMAIL
// ============================================

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token) {
      throw ErrorTypes.ValidationError('Verification token required');
    }

    // 1. Vérifier et consommer le token
    const { userId } = await verifyAndConsumeToken(token);

    // 2. Marquer email comme vérifié
    const user = await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
      select: {
        id: true,
        email: true,
        emailVerified: true
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
        userAgent: req.get('user-agent')
      }
    });

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Email verified successfully',
      data: {
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
     throw ErrorTypes.InternalError(error.message);
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
      throw ErrorTypes.NotFound('User not found');
    }

    if (user.emailVerified) {
      throw ErrorTypes.ValidationError('Email already verified');
    }

    // Créer nouveau token
    const verificationToken = await createVerificationToken(user.id, user.email);

    // Envoyer email
    await sendVerificationEmail(user.email, verificationToken, user.fullName);

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Verification email sent'
    });

  } catch (error) {
     throw ErrorTypes.InternalError(error.message);
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
      throw ErrorTypes.NotFound('User not found');
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
     throw ErrorTypes.InternalError(error.message);
  }
};

export const signout = async (req, res, next) => {
  try {
    // Clear the authentication cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: true,
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
     throw ErrorTypes.InternalError(error.message);
  }
};