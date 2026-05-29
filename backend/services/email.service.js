import { nanoid } from 'nanoid';
import prisma from '../lib/prisma.js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

const getBaseUrl = () => {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
};

const createToken = async (userId, type, expiresInHours) => {
  await prisma.verificationToken.deleteMany({
    where: { userId, type }
  });

  const token = nanoid(64);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  await prisma.verificationToken.create({
    data: { userId, token, type, expiresAt }
  });

  return token;
};

export const createVerificationToken = async (userId) => {
  return createToken(userId, 'EMAIL_VERIFICATION', 24);
};

export const createPasswordResetToken = async (userId) => {
  return createToken(userId, 'PASSWORD_RESET', 1);
};

export const verifyAndConsumeToken = async (token, type) => {
  const now = new Date();
  const verificationToken = await prisma.verificationToken.findFirst({
    where: { token, type },
    include: { user: { select: { id: true, email: true } } }
  });

  if (!verificationToken) {
    throw new Error('Token invalide ou déjà utilisé');
  }

  if (now > verificationToken.expiresAt) {
    await prisma.verificationToken.delete({ where: { id: verificationToken.id } });
    throw new Error('Lien expiré');
  }

  await prisma.verificationToken.delete({ where: { id: verificationToken.id } });
  return { userId: verificationToken.userId, email: verificationToken.user.email };
};

export const sendVerificationEmail = async (email, token, fullName) => {
  const baseUrl = getBaseUrl();
  // NE PAS MODIFIER : format ?token= requis par la page web /verify-email
  const verificationUrl = `${baseUrl}/verify-email?token=${token}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
      <div style="background: #667eea; color: white; padding: 20px; text-align: center;">
        <h1>Vérifiez votre compte SUPFile</h1>
      </div>
      <div style="padding: 30px; color: #333;">
        <p>Bonjour <strong>${fullName || 'Utilisateur'}</strong>,</p>
        <p>Pour activer votre compte, cliquez sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background: #667eea; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Activer mon compte
          </a>
        </div>
        <p style="font-size: 12px; color: #666;">Ce lien expire dans 24 heures.</p>
      </div>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: `SUPFile <${FROM_EMAIL}>`,
      to: email,
      subject: 'Vérifiez votre adresse email - SUPFile',
      html: emailHtml,
    });
    if (error) throw new Error(error.message);
    console.log(`✅ [Resend] Email de vérification envoyé à ${email}`);
  } catch (error) {
    console.error('❌ [Resend] Erreur:', error.message);
    console.log(`🔗 [Fallback] Lien de vérification : ${verificationUrl}`);
  }
};

export const sendPasswordResetEmail = async (email, token, fullName) => {
  const baseUrl = getBaseUrl();
  const resetUrl = `${baseUrl}/reset-password/${token}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
      <div style="background: #667eea; color: white; padding: 20px; text-align: center;">
        <h1>Réinitialisation de votre mot de passe</h1>
      </div>
      <div style="padding: 30px; color: #333;">
        <p>Bonjour <strong>${fullName || 'Utilisateur'}</strong>,</p>
        <p>Vous avez demandé une réinitialisation de mot de passe. Cliquez sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #667eea; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Réinitialiser mon mot de passe
          </a>
        </div>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
        <p style="font-size: 12px; color: #666;">Ce lien expire dans 1 heure.</p>
      </div>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: `SUPFile <${FROM_EMAIL}>`,
      to: email,
      subject: 'Réinitialisez votre mot de passe - SUPFile',
      html: emailHtml,
    });
    if (error) throw new Error(error.message);
    console.log(`✅ [Resend] Email de réinitialisation envoyé à ${email}`);
  } catch (error) {
    console.error('❌ [Resend] Erreur:', error.message);
    console.log(`🔗 [Fallback] Lien de réinitialisation : ${resetUrl}`);
  }
};

export const cleanupExpiredTokens = async () => {
  const result = await prisma.verificationToken.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
  return result.count;
};
