import bcrypt from 'bcrypt';
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
        // En prod (REQUIRE_EMAIL_VERIFICATION!=='false') on désactive le compte jusqu'à vérification,
        // en dev on active directement pour faciliter le travail.  -- fusion WEB+MOBILE
        isActive: process.env.REQUIRE_EMAIL_VERIFICATION === 'false',
        avatarUrl: '/public/images/default-avatar-profile.avif',
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

    // Créer les 4 dossiers par défaut
    const defaultFolders = ['Documents', 'Photos', 'Videos', 'Audio'];
    for (const folderName of defaultFolders) {
      await prisma.folder.create({
        data: {
          name: folderName,
          ownerId: user.id,
          path: `/${folderName}`
        }
      });
    }

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

    // Vérification email pilotée par l'environnement  -- apport WEB
    // En production (défaut) on exige la vérification ; en dev on peut désactiver via REQUIRE_EMAIL_VERIFICATION=false
    if (!user.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false') {
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
// OAuth Signin
// ============================================
export const OauthSignin = async (req, res, next) => {
  console.log('=== OAUTH SIGNIN CALLED ===');
  try {
    const { idToken, provider } = req.body;
    console.log('Provider:', provider);

    if (!idToken) throw ErrorTypes.BadRequest("ID Token requis");
    if (!provider) throw ErrorTypes.BadRequest("Provider requis (google ou microsoft)");

    let email, name, picture, uid;

    // Vérifier le token selon le provider
    if (provider === 'google') {
      // Vérifier le token Google via l'API Google tokeninfo
      const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!googleResponse.ok) {
        const errorData = await googleResponse.json();
        console.error('Google token error:', errorData);
        throw ErrorTypes.Unauthorized(`Token Google invalide: ${errorData.error_description || 'Erreur de vérification'}`);
      }
      const googleData = await googleResponse.json();
      email = googleData.email;
      name = googleData.name;
      picture = googleData.picture;
      uid = googleData.sub;
      console.log('Google user:', email, name);
    } else if (provider === 'microsoft') {
      // Pour Microsoft, décoder le id_token (JWT)
      try {
        const parts = idToken.split('.');
        if (parts.length !== 3) throw new Error('Format de token invalide');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        email = payload.email || payload.preferred_username || payload.upn;
        name = payload.name;
        picture = null;
        uid = payload.sub || payload.oid;
        console.log('Microsoft user:', email, name);
        if (!email) throw new Error('Email non trouvé dans le token');
      } catch (decodeError) {
        console.error('Microsoft token decode error:', decodeError);
        throw ErrorTypes.Unauthorized('Token Microsoft invalide: ' + decodeError.message);
      }
    } else {
      throw ErrorTypes.BadRequest("Provider non supporté");
    }

    if (!email) throw ErrorTypes.BadRequest("Email invalide dans le token");

    // Chercher ou créer l'utilisateur
    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Créer un nouvel utilisateur
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

      // Créer le dossier racine
      await prisma.folder.create({
        data: { name: 'My Files', ownerId: user.id, path: '/My Files' }
      });
      
      // Créer les 4 dossiers par défaut
      const defaultFolders = ['Documents', 'Photos', 'Videos', 'Audios'];
      for (const folderName of defaultFolders) {
        await prisma.folder.create({
          data: {
            name: folderName,
            ownerId: user.id,
            path: `/${folderName}`
          }
        });
      }
      console.log('New user created:', user.email);
    } else {
      // Mettre à jour l'avatar OAuth seulement si l'utilisateur n'a pas uploadé un avatar custom
      const hasCustomAvatar = user.avatarUrl && user.avatarUrl.startsWith('/uploads/');
      if (picture && !hasCustomAvatar && picture !== user.avatarUrl) {
        await prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: picture }
        });
      }
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true, email: true, fullName: true, theme: true,
          emailVerified: true, isActive: true, storageUsed: true,
          storageQuota: true, avatarUrl: true, createdAt: true,
        }
      });
      console.log('Existing user logged in:', user.email);
    }

    // Générer le JWT
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
      message: `Connecté via ${provider}`,
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
    console.error('OAuth error:', error);
    next(error);
  }
};
export const OauthSignup = async (req, res, next) => {
  try {
    const { idToken, provider } = req.body;
    console.log('=== OAuth Signup - Provider:', provider);

    if (!idToken) throw ErrorTypes.BadRequest("ID Token requis");

    let decodedToken;
    
    // Vérifier si c'est un token de test
    if (idToken.includes("mock_")) {
      console.log('=== Using mock OAuth token for testing ===');
      
      // Extraire l'email du token mock
      let email = 'mockuser@example.com';
      if (idToken.includes('user_gmail_com')) {
        email = 'user@gmail.com';
      } else if (idToken.includes('work_company_com')) {
        email = 'work@company.com';
      } else if (idToken.includes('personal_outlook_com')) {
        email = 'personal@outlook.com';
      }
      
      // Utiliser le provider fourni ou le déduire du token
      const oauthProvider = provider || (idToken.includes('google') ? 'google.com' : 'microsoft.com');
      
      decodedToken = {
        email: email,
        name: email.split('@')[0], // Use email prefix as name
        picture: null,
        uid: 'mock_user_id_' + Date.now(),
        firebase: {
          sign_in_provider: oauthProvider
        }
      };
    } else {
      // SECURITY: Verify token to get the real email
      decodedToken = await admin.auth().verifyIdToken(idToken);
      // Si le provider est fourni, l'utiliser pour la cohérence
      if (provider && decodedToken.firebase) {
        decodedToken.firebase.sign_in_provider = provider === 'google' ? 'google.com' : 'microsoft.com';
      }
    }
    
    const { email, name, picture, uid, firebase } = decodedToken;
    const oauthProvider = firebase.sign_in_provider;

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
      message: `Compte créé via ${formatProviderName(oauthProvider)}`,
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
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        theme: true,
        storageUsed: true,
        storageQuota: true
      }
    });

    const safeUser = {
      ...user,
      storageUsed: user.storageUsed.toString(),
      storageQuota: user.storageQuota.toString()
    };

    console.log('getCurrentUser returning user with avatarUrl:', safeUser.avatarUrl);
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
// UPDATE PROFILE
// ============================================
export const updateProfile = async (req, res, next) => {
  try {
    console.log('=== Update Profile Debug ===');
    console.log('Request body:', req.body);
    console.log('User from middleware:', req.user);
    
    const { fullName, email, avatarUrl } = req.body;
    const userId = req.user.id;

    console.log('Updating profile for userId:', userId);
    console.log('Profile data:', { fullName, email, avatarUrl });

    // Validation des données
    if (!fullName && !email && !avatarUrl) {
      throw ErrorTypes.BadRequest('Au moins un champ (fullName, email ou avatarUrl) doit être fourni');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw ErrorTypes.BadRequest('Email invalide');
    }

    // Construire l'objet de mise à jour
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email.toLowerCase();
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    // Vérifier si l'email est déjà utilisé par un autre utilisateur
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
          id: { not: userId }
        }
      });

      if (existingUser) {
        throw ErrorTypes.Conflict('Cet email est déjà utilisé par un autre compte');
      }
    }

    // Mettre à jour l'utilisateur
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
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
        updatedAt: true,
      }
    });

    // Convertir BigInt en string pour éviter les erreurs de sérialisation
    const safeUser = {
      ...updatedUser,
      storageUsed: updatedUser.storageUsed.toString(),
      storageQuota: updatedUser.storageQuota.toString()
    };

    res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès',
      data: safeUser
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// SIGNOUT
// ============================================
// Changer le mot de passe
export const changePassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const userId = req.user.id;

    if (!newPassword) {
      throw ErrorTypes.BadRequest('Le nouveau mot de passe est requis');
    }

    if (newPassword.length < 6) {
      throw ErrorTypes.BadRequest('Le nouveau mot de passe doit contenir au moins 6 caractères');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.status(200).json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    next(error);
  }
};

// Mettre à jour le thème
export const updateTheme = async (req, res, next) => {
  try {
    const { theme } = req.body;
    const userId = req.user.id;

    if (!theme || !['light', 'dark', 'system'].includes(theme)) {
      throw ErrorTypes.BadRequest('Thème invalide (light, dark ou system)');
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { theme },
      select: { id: true, theme: true }
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// Upload avatar
export const uploadAvatarHandler = async (req, res, next) => {
  try {
    if (!req.file) {
      throw ErrorTypes.BadRequest('Aucune image fournie');
    }

    const userId = req.user.id;
    const avatarUrl = `/uploads/profiles/${req.file.filename}`;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
      }
    });

    res.status(200).json({
      success: true,
      message: 'Avatar mis à jour avec succès',
      data: user
    });
  } catch (error) {
    next(error);
  }
};

export const signout = async (req, res, next) => {
  res.clearCookie('access_token').status(200).json({ success: true, message: 'Déconnecté' });
};


