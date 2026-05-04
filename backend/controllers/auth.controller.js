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

// Initialisation de Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const formatProviderName = (providerId) => {
    if (!providerId) return 'OAuth';
    const name = providerId.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
};

// ============================================
// SIGNUP (Local)
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
        avatarUrl: '/public/images/default-avatar-profile.avif',
      },
      select: {
        id: true, email: true, fullName: true, theme: true,
        emailVerified: true, isActive: true, storageUsed: true,
        storageQuota: true, avatarUrl: true, createdAt: true,
      }
    });

    await prisma.folder.create({
      data: { name: 'My Files', ownerId: user.id, path: '/My Files' }
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
// SIGNIN (Local)
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
// OAUTH SIGNIN / SIGNUP (Fusionné)
// ============================================
export const OauthSignin = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) throw ErrorTypes.BadRequest("ID Token requis");

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, name, picture, uid, firebase } = decodedToken;
    const provider = firebase.sign_in_provider;

    if (!email) throw ErrorTypes.BadRequest("Email invalide dans le token");

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    // Si l'utilisateur n'existe pas, on le crée (Signup automatique)
    if (!user) {
      const generatedPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(generatedPassword, 12);

      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          fullName: name || null,
          emailVerified: true,
          isActive: true,
          avatarUrl: picture || null,
          oauthProvider: provider,
          oauthId: uid,
        }
      });

      await prisma.folder.create({
        data: { name: 'My Files', ownerId: user.id, path: '/My Files' }
      });
    }

    // Connexion (Génération du JWT)
    const token = jwt.sign(
      { id: user.id, email: user.email, fullName: user.fullName },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }).status(200).json({
      success: true,
      message: `Connecté via ${formatProviderName(provider)}`,
      data: { token, user }
    });

  } catch (error) {
    next(error);
  }
};

// Placeholder pour OauthSignup si tu veux garder la route séparée
export const OauthSignup = async (req, res, next) => {
    // On redirige vers la logique de Signin qui gère déjà la création
    return OauthSignin(req, res, next);
};

// ============================================
// AUTRES FONCTIONS (Vérification, Password, etc.)
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

export const getCurrentUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, fullName: true, storageUsed: true, storageQuota: true
      }
    });

    res.status(200).json({ 
      success: true, 
      data: {
        ...user,
        storageUsed: user.storageUsed.toString(),
        storageQuota: user.storageQuota.toString()
      } 
    });
  } catch (error) {
    next(error);
  }
};

export const signout = async (req, res, next) => {
  res.clearCookie('access_token').status(200).json({ success: true, message: 'Déconnecté' });
};
// ============================================
// FORGOT PASSWORD
// ============================================
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) throw ErrorTypes.BadRequest("L'adresse email est requise.");

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (user) {
      const resetToken = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(user.email, resetToken, user.fullName);
    }

    res.status(200).json({
      success: true,
      message: "Si un compte existe, un lien de réinitialisation a été envoyé."
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

    const { userId } = await verifyAndConsumeToken(token, 'PASSWORD_RESET');
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.status(200).json({ success: true, message: "Mot de passe réinitialisé." });
  } catch (error) {
    next(error);
  }
};