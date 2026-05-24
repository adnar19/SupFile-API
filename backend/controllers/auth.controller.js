import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { validateSignupData, validateSigninData, validatePassword } from '../utils/validator.js';
import {
  createVerificationToken,
  sendVerificationEmail,
  verifyAndConsumeToken,
  createPasswordResetToken,
  sendPasswordResetEmail
} from '../services/email.service.js';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!admin.apps.length) {
  admin.initializeApp();
}

const formatProviderName = (providerId) => {
  if (!providerId) return 'OAuth';
  const name = providerId.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
};

const DEFAULT_FOLDERS = ['Documents', 'Photos', 'Videos', 'Audio'];

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
    if (existingUser) throw ErrorTypes.Conflict('Cet email est deja utilise');

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: fullName || null,
        emailVerified: false,
        isActive: true,
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
    for (const folderName of DEFAULT_FOLDERS) {
      await prisma.folder.create({
        data: { name: folderName, ownerId: user.id, path: `/${folderName}` }
      });
    }

    const verificationToken = await createVerificationToken(user.id);
    await sendVerificationEmail(user.email, verificationToken, user.fullName);

    res.status(201).json({
      success: true,
      message: 'Compte cree. Verifiez votre email.',
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

    if (!user.isActive) {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    }

    if (!user.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false') {
      throw ErrorTypes.Forbidden('Veuillez verifier votre email.');
    }

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
      message: 'Connecte',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          theme: user.theme,
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
// OAUTH SIGNIN — Google tokeninfo + Microsoft JWT decode (pas Firebase Admin)
// ============================================
export const OauthSignin = async (req, res, next) => {
  try {
    const { idToken, provider } = req.body;

    if (!idToken) throw ErrorTypes.BadRequest('ID Token requis');
    if (!provider) throw ErrorTypes.BadRequest('Provider requis (google ou microsoft)');

    let email, name, picture, uid;

    if (provider === 'google') {
      const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!googleResponse.ok) {
        const errorData = await googleResponse.json();
        throw ErrorTypes.Unauthorized(`Token Google invalide: ${errorData.error_description || 'Erreur de verification'}`);
      }
      const googleData = await googleResponse.json();
      email = googleData.email;
      name = googleData.name;
      picture = googleData.picture;
      uid = googleData.sub;
    } else if (provider === 'microsoft') {
      try {
        const parts = idToken.split('.');
        if (parts.length !== 3) throw new Error('Format de token invalide');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        email = payload.email || payload.preferred_username || payload.upn;
        name = payload.name;
        picture = null;
        uid = payload.sub || payload.oid;
        if (!email) throw new Error('Email non trouve dans le token');
      } catch (decodeError) {
        throw ErrorTypes.Unauthorized('Token Microsoft invalide: ' + decodeError.message);
      }
    } else {
      throw ErrorTypes.BadRequest('Provider non supporte');
    }

    if (!email) throw ErrorTypes.BadRequest('Email invalide dans le token');

    let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      const generatedPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(generatedPassword, 12);

      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          fullName: name || email.split('@')[0],
          emailVerified: true,
          isActive: true,
          avatarUrl: picture || null,
          oauthProvider: provider,
          oauthId: uid,
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
      for (const folderName of DEFAULT_FOLDERS) {
        await prisma.folder.create({
          data: { name: folderName, ownerId: user.id, path: `/${folderName}` }
        });
      }
    } else {
      const hasCustomAvatar = user.avatarUrl && user.avatarUrl.startsWith('/uploads/');
      const updateData = { isActive: true, emailVerified: true };
      if (picture && !hasCustomAvatar && picture !== user.avatarUrl) {
        updateData.avatarUrl = picture;
      }
      await prisma.user.update({ where: { id: user.id }, data: updateData });
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true, email: true, fullName: true, theme: true,
          emailVerified: true, isActive: true, storageUsed: true,
          storageQuota: true, avatarUrl: true, createdAt: true,
        }
      });
    }

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
      statusCode: 200,
      message: `Connecte via ${provider}`,
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
// OAUTH SIGNUP — Firebase Admin (utilisé côté mobile)
// ============================================
export const OauthSignup = async (req, res, next) => {
  try {
    const { idToken, provider } = req.body;

    if (!idToken) throw ErrorTypes.BadRequest('ID Token requis');

    let decodedToken;

    if (idToken.includes('mock_')) {
      let email = 'mockuser@example.com';
      if (idToken.includes('user_gmail_com')) email = 'user@gmail.com';
      else if (idToken.includes('work_company_com')) email = 'work@company.com';
      else if (idToken.includes('personal_outlook_com')) email = 'personal@outlook.com';

      const oauthProvider = provider || (idToken.includes('google') ? 'google.com' : 'microsoft.com');
      decodedToken = {
        email,
        name: email.split('@')[0],
        picture: null,
        uid: 'mock_user_id_' + Date.now(),
        firebase: { sign_in_provider: oauthProvider }
      };
    } else {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      if (provider && decodedToken.firebase) {
        decodedToken.firebase.sign_in_provider = provider === 'google' ? 'google.com' : 'microsoft.com';
      }
    }

    const { email, name, picture, uid, firebase } = decodedToken;
    const oauthProvider = firebase.sign_in_provider;

    if (!email) throw ErrorTypes.BadRequest('Email invalide dans le token');

    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      throw ErrorTypes.Conflict('Cet email est deja utilise. Veuillez vous connecter.');
    }

    const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: name,
        emailVerified: true,
        isActive: true,
        avatarUrl: picture || null,
        oauthProvider: provider,
        oauthId: uid,
      },
      select: {
        id: true, email: true, fullName: true, theme: true,
        emailVerified: true, oauthProvider: true, isActive: true,
        storageUsed: true, storageQuota: true, createdAt: true,
      }
    });

    await prisma.folder.create({
      data: { name: 'My Files', ownerId: user.id, path: '/My Files' }
    });

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
    }).status(201).json({
      success: true,
      message: `Compte cree via ${formatProviderName(oauthProvider)}`,
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
    res.status(200).json({ success: true, message: 'Email verifie' });
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
        id: true, email: true, fullName: true, avatarUrl: true,
        theme: true, storageUsed: true, storageQuota: true
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

// ============================================
// RESEND VERIFICATION EMAIL
// ============================================
export const resendVerificationEmail = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw ErrorTypes.NotFound('Utilisateur non trouve.');
    if (user.emailVerified) {
      return res.status(200).json({ success: true, message: 'Votre email est deja verifie.' });
    }
    const token = await createVerificationToken(user.id);
    await sendVerificationEmail(user.email, token, user.fullName);
    res.status(200).json({ success: true, message: 'Email renvoye' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// SIGNOUT
// ============================================
export const signout = async (req, res, next) => {
  res.clearCookie('access_token').status(200).json({ success: true, message: 'Deconnecte' });
};

// ============================================
// FORGOT PASSWORD
// ============================================
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) throw ErrorTypes.BadRequest("L'adresse email est requise.");

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (user) {
      const resetToken = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(user.email, resetToken, user.fullName);
    }

    res.status(200).json({
      success: true,
      message: "Si un compte est associe a cet email, un lien de reinitialisation a ete envoye."
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
      throw ErrorTypes.BadRequest('Les mots de passe ne correspondent pas.');
    }

    validatePassword(password);

    const { userId } = await verifyAndConsumeToken(token, 'PASSWORD_RESET');
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, passwordChangedAt: new Date() }
    });

    res.status(200).json({ success: true, message: 'Mot de passe reinitialise. Vous pouvez maintenant vous connecter.' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// UPDATE PROFILE
// ============================================
export const updateProfile = async (req, res, next) => {
  try {
    const { fullName, email, avatarUrl } = req.body;
    const userId = req.user.id;

    if (!fullName && !email && avatarUrl === undefined) {
      throw ErrorTypes.BadRequest('Au moins un champ doit etre fourni');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw ErrorTypes.BadRequest('Email invalide');
    }

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), id: { not: userId } }
      });
      if (existingUser) throw ErrorTypes.Conflict('Cet email est deja utilise par un autre compte');
    }

    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email.toLowerCase();
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true, email: true, fullName: true, theme: true,
        emailVerified: true, isActive: true, storageUsed: true,
        storageQuota: true, avatarUrl: true, createdAt: true, updatedAt: true,
      }
    });

    res.status(200).json({
      success: true,
      message: 'Profil mis a jour avec succes',
      data: {
        ...updatedUser,
        storageUsed: updatedUser.storageUsed.toString(),
        storageQuota: updatedUser.storageQuota.toString()
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// CHANGE PASSWORD
// Web : envoie currentPassword + newPassword + confirmPassword → currentPassword verifie
// Mobile : envoie seulement newPassword → passe directement
// ============================================
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!newPassword) throw ErrorTypes.BadRequest('Le nouveau mot de passe est requis');

    if (confirmPassword && newPassword !== confirmPassword) {
      throw ErrorTypes.BadRequest('Les nouveaux mots de passe ne correspondent pas.');
    }

    if (newPassword.length < 6) {
      throw ErrorTypes.BadRequest('Le mot de passe doit contenir au moins 6 caracteres');
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (currentPassword) {
      if (!user.password) throw ErrorTypes.BadRequest('Impossible de changer le mot de passe pour ce compte.');
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) throw ErrorTypes.Unauthorized('Mot de passe actuel incorrect.');
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed, passwordChangedAt: new Date() }
    });

    res.status(200).json({ success: true, message: 'Mot de passe modifie avec succes' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// UPDATE THEME
// ============================================
export const updateTheme = async (req, res, next) => {
  try {
    const { theme } = req.body;
    if (!theme || !['light', 'dark', 'system'].includes(theme)) {
      throw ErrorTypes.BadRequest('Theme invalide (light, dark ou system)');
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { theme },
      select: { id: true, theme: true }
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// ============================================
// UPLOAD AVATAR
// ============================================
export const uploadAvatarHandler = async (req, res, next) => {
  try {
    if (!req.file) throw ErrorTypes.BadRequest('Aucune image fournie');

    const avatarUrl = `/uploads/profiles/${req.file.filename}`;

    const current = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { avatarUrl: true }
    });

    if (current?.avatarUrl && current.avatarUrl.startsWith('/uploads/profiles/')) {
      const oldPath = path.join(__dirname, '..', current.avatarUrl);
      fs.unlink(oldPath, () => {});
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: { id: true, email: true, fullName: true, avatarUrl: true }
    });

    res.status(200).json({ success: true, message: 'Avatar mis a jour avec succes', data: user });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DELETE ACCOUNT
// ============================================
export const deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const userFiles = await prisma.file.findMany({
      where: { ownerId: userId },
      select: { storageName: true }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true }
    });

    await prisma.user.delete({ where: { id: userId } });

    const { unlink } = await import('fs/promises');
    const { join } = await import('path');

    for (const file of userFiles) {
      try { await unlink(join('uploads', file.storageName)); } catch {}
    }

    if (user?.avatarUrl && user.avatarUrl.startsWith('/uploads/')) {
      try {
        const avatarFileName = user.avatarUrl.split('/').pop();
        if (avatarFileName) await unlink(join('uploads', 'profiles', avatarFileName));
      } catch {}
    }

    res.clearCookie('access_token').status(200).json({
      success: true,
      message: 'Votre compte et toutes vos donnees ont ete supprimes definitivement.'
    });
  } catch (error) {
    next(error);
  }
};
