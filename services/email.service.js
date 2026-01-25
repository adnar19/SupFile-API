import { nanoid } from 'nanoid';
import prisma from '../lib/prisma.js';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import axios from 'axios'; // N'oublie pas de faire : npm install axios

dotenv.config();

/**
 * Helper pour détecter l'URL Ngrok dynamiquement
 * Si Ngrok tourne, on prend son URL, sinon on utilise localhost
 */
const getBaseUrl = async () => {
  // En production, on utilise l'URL fixe définie dans le .env
  if (process.env.NODE_ENV === 'production') {
    return process.env.FRONTEND_URL || 'https://votre-domaine.com';
  }

  try {
    // Ngrok expose une API locale sur le port 4040 pour donner ses infos
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels', { timeout: 1000 });
    const publicUrl = response.data.tunnels[0].public_url;
    console.log(`📡 [Auto-Config] URL Ngrok détectée : ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    // Si l'API ngrok ne répond pas, on revient par défaut sur localhost
    return process.env.FRONTEND_URL || 'http://localhost:3000';
  }
};

/**
 * Configuration du transporteur Nodemailer (Gmail)
 */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const createVerificationToken = async (userId, email) => {
  await prisma.verificationToken.deleteMany({
    where: { userId, type: 'EMAIL_VERIFICATION' }
  });

  const token = nanoid(64);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await prisma.verificationToken.create({
    data: { userId, token, type: 'EMAIL_VERIFICATION', expiresAt }
  });

  return token;
};

export const verifyAndConsumeToken = async (token) => {
  const now = new Date();
  const verificationToken = await prisma.verificationToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true } } }
  });

  if (!verificationToken) throw new Error('Token invalide');
  if (now > verificationToken.expiresAt) {
    await prisma.verificationToken.delete({ where: { id: verificationToken.id } });
    throw new Error('Lien expiré');
  }

  await prisma.verificationToken.delete({ where: { id: verificationToken.id } });
  return { userId: verificationToken.userId, email: verificationToken.user.email };
};

/**
 * Envoi de l'email avec détection automatique de l'URL
 */
export const sendVerificationEmail = async (email, token, fullName) => {
  // --- DÉTECTION AUTOMATIQUE DE L'URL ---
  const baseUrl = await getBaseUrl();
  const verificationUrl = `${baseUrl}/auth/verify-email/${token}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
      <div style="background: #667eea; color: white; padding: 20px; text-align: center;">
        <h1>Vérifiez votre compte SUPFile</h1>
      </div>
      <div style="padding: 30px; color: #333;">
        <p>Bonjour <strong>${fullName || 'Utilisateur'}</strong> 👋,</p>
        <p>Pour activer votre compte, cliquez sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background: #667eea; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            ✅ Activer mon compte
          </a>
        </div>
        <p style="font-size: 12px; color: #666;">Lien envoyé via : ${baseUrl}</p>
      </div>
    </div>
  `;

  // 1. Essai avec Gmail (Nodemailer)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      await transporter.sendMail({
        from: `"SUPFile" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Vérifiez votre adresse email - SUPFile',
        html: emailHtml,
      });
      console.log(`✅ [Nodemailer] Email envoyé à ${email}`);
      return;
    } catch (error) {
      console.error('❌ [Nodemailer] Erreur:', error.message);
    }
  }

  // 2. Fallback console (toujours utile si l'email échoue)
  console.log(`🔗 [Fallback] Lien de vérification : ${verificationUrl}`);
};

export const cleanupExpiredTokens = async () => {
  const result = await prisma.verificationToken.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
  return result.count;
};