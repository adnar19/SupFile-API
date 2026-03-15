import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { validateSignupData, validateSigninData } from '../utils/validator.js';
import { 
  createVerificationToken, 
  sendVerificationEmail,
  verifyAndConsumeToken,
  createPasswordResetToken,
  sendPasswordResetEmail
} from '../services/email.service.js';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';

// Initialisation de Firebase Admin pour la vérification des tokens
if (!admin.apps.length) {
  admin.initializeApp();
}

// Helper to format provider name for messages
const formatProviderName = (providerId) => {
    if (!providerId) return 'OAuth';
    const name = providerId.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
};

// ============================================
// SIGNUP
// ============================================
export const signup = async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    validateSignupData({ email, password, fullName });

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (existingUser) throw ErrorTypes.Conflict('Cet email est déjà utilisé');

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: fullName || null,
        emailVerified: false,
        isActive: false,
        avatarUrl: '../utils/default-avatar-profile.avif',
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
        avatarUrl: true,
        createdAt: true,
      }
    });

    await prisma.folder.create({
      data: {
        name: 'My Files',
        ownerId: user.id,
        path: '/My Files'
      }
    });

    const verificationToken = await createVerificationToken(user.id);
    await sendVerificationEmail(user.email, verificationToken, user.fullName);

    res.status(201).json({
      success: true,
      message: 'Compte créé. Vérifiez votre email.',
      data: {
        user: {
          ...user,
          storageUsed: user.storageUsed.toString(),
          storageQuota: user.storageQuota.toString(),
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// SIGNIN
// ============================================
export const signin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    validateSigninData({ email, password });

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw ErrorTypes.Unauthorized('Email ou mot de passe incorrect');
    }

    if (!user.emailVerified) {
      throw ErrorTypes.Forbidden('Veuillez vérifier votre email.');
    }

    const token = jwt.sign({ id: user.id, email: user.email, fullName: user.fullName }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }).status(200).json({
      success: true,
      message: 'Connecté',
      data: { token }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// OAuth Signin
// ============================================
export const OauthSignin = async (req, res, next) => {
  try {
      const { idToken } = req.body;
      if (!idToken) throw ErrorTypes.BadRequest("ID Token requis");

      // Vérification du token ID avec Firebase Admin
      // Cela garantit que l'email provient bien de Google/Provider et n'est pas usurpé
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { email, firebase } = decodedToken;
      const provider = firebase.sign_in_provider;

      if (!email) throw ErrorTypes.BadRequest("Email invalide dans le token");

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      if (!user) {
        throw ErrorTypes.NotFound('Utilisateur non trouvé');
      }

      // Update user info if logging in via OAuth (Link account / Verify email)
      if (!user.emailVerified || !user.oauthId) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            emailVerified: true,
            oauthProvider: user.oauthProvider || decodedToken.firebase.sign_in_provider,
            oauthId: user.oauthId || decodedToken.uid,
            avatarUrl: user.avatarUrl || decodedToken.picture || null
          }
        });
      }

      const token = jwt.sign({ id: user.id, email: user.email, fullName: user.fullName }, process.env.JWT_SECRET, { expiresIn: '24h' });
      
      res.cookie('access_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
      }).status(200).json({
        success: true,
      message: `Connecté via ${formatProviderName(provider)}`,
        data: { token }
      });
  } catch (error) {
    next(error);
  }
};

// ============================================
// OAuth SIGNUP
// ============================================
export const OauthSignup = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) throw ErrorTypes.BadRequest("ID Token requis");

    // SECURITY: Verify token to get the real email
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, name, picture, uid, firebase } = decodedToken;
    const provider = firebase.sign_in_provider;

    if (!email) throw ErrorTypes.BadRequest("Email invalide dans le token");

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      throw ErrorTypes.Conflict('Cet email est déjà utilisé. Veuillez vous connecter.');
    }
   // Génération d'un mot de passe aléatoire pour les utilisateurs OAuth 
    const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
    // Hashage du mot de passe généré une bonne pratique de le stocker de manière sécurisée
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: name, // Use name from verified token
        emailVerified: true, // OAuth users are verified by the provider
        isActive: true,
        avatarUrl: picture || null, // Correct field name and use picture from token
        oauthProvider: provider,
        oauthId: uid,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        theme: true,
        emailVerified: true,
        oauthProvider: true,
        isActive: true,
        storageUsed: true,
        storageQuota: true,
        createdAt: true,
      }
    });

    await prisma.folder.create({
      data: {
        name: 'My Files',
        ownerId: user.id,
        path: '/My Files'
      }
    });

    const token = jwt.sign({ id: user.id, email: user.email, fullName: user.fullName }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }).status(201).json({
      success: true,
      message: `Compte créé via ${formatProviderName(provider)}`,
      data: {
        token,
        user: {
          ...user,
          storageUsed: user.storageUsed.toString(),
          storageQuota: user.storageQuota.toString(),
        }
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
    const { userId } = await verifyAndConsumeToken(token, 'EMAIL_VERIFICATION');
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, isActive: true }
    });
    res.status(200).json({ success: true, message: 'Email vérifié' });
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
        id: true, email: true, fullName: true, storageUsed: true, storageQuota: true
      }
    });

    const safeUser = {
      ...user,
      storageUsed: user.storageUsed.toString(),
      storageQuota: user.storageQuota.toString()
    };

    res.status(200).json({ success: true, data: safeUser });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RESEND VERIFICATION
// ============================================
export const resendVerificationEmail = async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) throw ErrorTypes.NotFound("Utilisateur non trouvé.");
      if (user.emailVerified) return res.status(200).json({ success: true, message: "Votre email est déjà vérifié." });

      const token = await createVerificationToken(user.id);
      await sendVerificationEmail(user.email, token, user.fullName);
      res.status(200).json({ success: true, message: 'Email renvoyé' });
    } catch (error) { next(error); }
};

// ============================================
// FORGOT PASSWORD
// ============================================
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      throw ErrorTypes.BadRequest("L'adresse email est requise.");
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    // IMPORTANT: Ne pas révéler si l'utilisateur existe ou non.
    // Toujours envoyer une réponse de succès pour éviter les attaques par énumération d'utilisateurs.
    if (user) {
      const resetToken = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(user.email, resetToken, user.fullName);
    }

    res.status(200).json({
      success: true,
      message: "Si un compte est associé à cet email, un lien de réinitialisation a été envoyé."
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// RESET PASSWORD
// ============================================
export const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      throw ErrorTypes.BadRequest("Les mots de passe ne correspondent pas.");
    }

    validatePassword(password);

    const { userId } = await verifyAndConsumeToken(token, 'PASSWORD_RESET');
    
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, passwordChangedAt: new Date() }
    });

    res.status(200).json({ success: true, message: "Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter." });
  } catch (error) {
    if (error.message.includes('invalide') || error.message.includes('expiré')) {
        return next(ErrorTypes.BadRequest(error.message));
    }
    next(error);
  }
};

// ============================================
// SIGNOUT
// ============================================
export const signout = async (req, res, next) => {
  res.clearCookie('access_token').status(200).json({ success: true, message: 'Déconnecté' });
};
