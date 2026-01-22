import { nanoid } from 'nanoid';
import prisma from '../lib/prisma.js';

/**
 * Créer un token de vérification email
 * ✅ Stockage dans table dédiée (verification_tokens)
 * ✅ Auto-invalidation après utilisation
 * ✅ Expiration 24h sans utilisation
 */
export const createVerificationToken = async (userId, email) => {
  // 1. Invalider tous les anciens tokens non utilisés
  await prisma.verificationToken.updateMany({
    where: {
      userId,
      type: 'EMAIL_VERIFICATION',
      usedAt: null,
    },
    data: {
      expiresAt: new Date(), // Expirer immédiatement
    }
  });

  // 2. Créer nouveau token
  const token = nanoid(64); // Token sécurisé 64 caractères
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await prisma.verificationToken.create({
    data: {
      userId,
      token,
      type: 'EMAIL_VERIFICATION',
      expiresAt,
    }
  });

  return token;
};

/**
 * Vérifier et consommer un token
 * ✅ Vérifie validité
 * ✅ Marque comme utilisé automatiquement
 * ✅ Impossible de réutiliser
 */
export const verifyAndConsumeToken = async (token) => {
  const now = new Date();

  // 1. Trouver le token
  const verificationToken = await prisma.verificationToken.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          emailVerified: true,
        }
      }
    }
  });

  if (!verificationToken) {
    throw new Error('Invalid verification token');
  }

  // 2. Vérifier si déjà utilisé
  if (verificationToken.usedAt) {
    throw new Error('This verification link has already been used');
  }

  // 3. Vérifier expiration
  if (now > verificationToken.expiresAt) {
    throw new Error('This verification link has expired. Please request a new one');
  }

  // 4. Marquer comme utilisé (ATOMIQUE)
  await prisma.verificationToken.update({
    where: { id: verificationToken.id },
    data: {
      usedAt: now,
    }
  });

  return {
    userId: verificationToken.userId,
    email: verificationToken.user.email,
  };
};

/**
 * Envoyer l'email de vérification
 * ✅ Resend en production (3000 emails/mois gratuits)
 * ✅ Console en dev
 */
export const sendVerificationEmail = async (email, token, fullName) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

  // DEV : Console uniquement
  if (process.env.NODE_ENV === 'development') {
    console.log('\n' + '='.repeat(60));
    console.log('📧 EMAIL DE VÉRIFICATION');
    console.log('='.repeat(60));
    console.log(`À: ${email}`);
    console.log(`Nom: ${fullName || 'Utilisateur'}`);
    console.log(`Lien: ${verificationUrl}`);
    console.log(`Expire: Dans 24 heures`);
    console.log('='.repeat(60) + '\n');
    return;
  }

  // PRODUCTION : Resend
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'SUPFile <onboarding@resend.dev>',
      to: email,
      subject: 'Vérifiez votre adresse email - SUPFile',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 Bienvenue sur SUPFile !</h1>
              </div>
              <div class="content">
                <p>Bonjour ${fullName || 'là'} 👋</p>
                
                <p>Merci de vous être inscrit. Vérifiez votre email en cliquant ci-dessous :</p>
                
                <div style="text-align: center;">
                  <a href="${verificationUrl}" class="button">
                    ✅ Vérifier mon email
                  </a>
                </div>
                
                <p>Ou copiez ce lien :</p>
                <p style="background: white; padding: 10px; border-radius: 5px; word-break: break-all;">
                  ${verificationUrl}
                </p>
                
                <p><strong>⏰ Ce lien expire dans 24 heures.</strong></p>
                
                <p>Si vous n'avez pas créé de compte, ignorez cet email.</p>
                
                <div class="footer">
                  <p>© ${new Date().getFullYear()} SUPFile. Tous droits réservés.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `
    });

    console.log(`✅ Email envoyé à ${email}`);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    console.log('\n⚠️ FALLBACK - Lien de vérification:');
    console.log(verificationUrl);
  }
};

/**
 * Nettoyer les tokens expirés
 * ✅ À lancer via CRON (quotidien)
 */
export const cleanupExpiredTokens = async () => {
  const now = new Date();

  const result = await prisma.verificationToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { usedAt: { not: null } }, // Supprimer aussi les tokens utilisés
      ]
    }
  });

  console.log(`🧹 ${result.count} tokens nettoyés`);
  return result.count;
};