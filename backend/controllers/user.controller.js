import prisma from '../lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { validatePassword, validateEmail } from '../utils/validator.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { createVerificationToken, sendVerificationEmail } from '../services/email.service.js';

// GET user by ID
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw ErrorTypes.NotFound("Utilisateur non trouvé");
    }

    // Remove password from response
    const { password, ...userInfo } = user;

    // Convert BigInt to string for safe JSON serialization
    const safeUserInfo = {
      ...userInfo,
      storageUsed: userInfo.storageUsed.toString(),
      storageQuota: userInfo.storageQuota.toString(),
    };

    res.status(200).json(safeUserInfo);
  } catch (error) {
    next(error);
  }
};

// UPDATE user profile (fullName, email, theme, avatarUrl, password)
export const updateUserProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, email, theme, avatarUrl, oldPassword, newPassword } = req.body;

    // Ensure user is updating their own profile
    if (req.user.id !== id) {
      throw ErrorTypes.Forbidden("Vous n'êtes pas autorisé à modifier ce profil.");
    }

    const dataToUpdate = {};
    let newEmailVerificationNeeded = false;
    let passwordChanged = false;

    // Validate and prepare data for update
    if (fullName !== undefined) {
      if (String(fullName).trim().length < 2) {
        throw ErrorTypes.ValidationError('Le nom complet doit contenir au moins 2 caractères.');
      }
      dataToUpdate.fullName = String(fullName).trim();
    }

    if (theme !== undefined) {
      if (!['light', 'dark'].includes(theme)) {
        throw ErrorTypes.ValidationError("Le thème doit être 'light' ou 'dark'.");
      }
      dataToUpdate.theme = theme;
    }

    if (avatarUrl !== undefined) {
      // Une validation d'URL plus robuste pourrait être ajoutée ici
      dataToUpdate.avatarUrl = avatarUrl;
    }

    const currentUser = await prisma.user.findUnique({ where: { id } });
    if (!currentUser) {
      // This should not be reached if the 'protect' middleware is working correctly
      throw ErrorTypes.NotFound("Utilisateur non trouvé.");
    }

    // --- Password Update Logic ---
    if (newPassword && oldPassword) {
      if (oldPassword === newPassword) {
        throw ErrorTypes.BadRequest("Le nouveau mot de passe doit être différent de l'ancien.");
      }

      const isPasswordCorrect = await bcrypt.compare(oldPassword, currentUser.password);
      if (!isPasswordCorrect) {
        throw ErrorTypes.Unauthorized("L'ancien mot de passe est incorrect.");
      }

      validatePassword(newPassword);
      dataToUpdate.password = await bcrypt.hash(newPassword, 12);
      dataToUpdate.passwordChangedAt = new Date();
      passwordChanged = true;
    } else if ((newPassword && !oldPassword) || (!newPassword && oldPassword)) {
      throw ErrorTypes.BadRequest("Pour changer le mot de passe, l'ancien et le nouveau mot de passe sont requis.");
    }

    if (email && email.toLowerCase() !== currentUser.email) {
      if (!validateEmail(email)) {
        throw ErrorTypes.ValidationError("Format d'email invalide.");
      }
      const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existingUser) {
        throw ErrorTypes.Conflict('Cet email est déjà utilisé.');
      }
      dataToUpdate.email = email.toLowerCase();
      dataToUpdate.emailVerified = false; // L'utilisateur doit re-vérifier son nouvel email
      newEmailVerificationNeeded = true;
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return res.status(200).json({ success: true, message: "Aucune information à mettre à jour." });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });

    if (newEmailVerificationNeeded) {
      const verificationToken = await createVerificationToken(updatedUser.id);
      await sendVerificationEmail(updatedUser.email, verificationToken, updatedUser.fullName);
    }

    // Générer un nouveau token si l'email ou le nom a changé (car ils sont dans le payload)
    const token = jwt.sign({ id: updatedUser.id, email: updatedUser.email, fullName: updatedUser.fullName }, process.env.JWT_SECRET, { expiresIn: '24h' });

    const { password, ...userInfo } = updatedUser;

    let message = "Profil mis à jour avec succès.";
    if (passwordChanged && Object.keys(dataToUpdate).length > 2) { // password and passwordChangedAt + other fields
      message = "Profil et mot de passe mis à jour avec succès.";
    } else if (passwordChanged) {
      message = "Mot de passe mis à jour avec succès.";
    }

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }).status(200).json({
      success: true,
      message: message + (newEmailVerificationNeeded ? " Veuillez vérifier votre nouvelle adresse email." : ""),
      data: { user: { ...userInfo, storageUsed: userInfo.storageUsed.toString(), storageQuota: userInfo.storageQuota.toString() }, token }
    });

  } catch (error) {
    next(error);
  }
};