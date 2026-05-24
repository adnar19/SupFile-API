import express from 'express';
import { 
  signin, 
  signup, 
  signout, 
  verifyEmail, 
  OauthSignin, 
  OauthSignup,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  updateProfile,
  changePassword,
  updateTheme,
  uploadAvatarHandler,
  deleteAccount,
  resendVerificationEmail
} from '../controllers/auth.controller.js';
import { authLimiter } from '../middlewares/rateLimit.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadAvatar } from '../middlewares/upload.middleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentification et gestion de compte
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password]
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       201:
 *         description: Utilisateur créé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 */
router.post('/register', authLimiter, signup);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Connexion utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Connexion réussie (Cookie JWT défini)
 */
router.post('/login', authLimiter, signin);

/**
 * @swagger
 * /auth/oauth/signin:
 *   post:
 *     summary: Connexion via Google OAuth
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Token retourné par Firebase/Google
 */
router.post('/oauth/signin', OauthSignin);

/**
 * @swagger
 * /auth/oauth/signup:
 *   post:
 *     summary: Inscription via Google OAuth
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 */
router.post('/oauth/signup', OauthSignup);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Déconnexion
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Cookie supprimé
 */
router.post('/logout', signout);

/**
 * @swagger
 * /auth/verify-email/{token}:
 *   get:
 *     summary: Vérification de l'adresse email
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/verify-email/:token', verifyEmail);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Demander une réinitialisation de mot de passe
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 */
router.post('/forgot-password', authLimiter, forgotPassword);

/**
 * @swagger
 * /auth/reset-password/{token}:
 *   post:
 *     summary: Réinitialiser le mot de passe
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, confirmPassword]
 *             properties:
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 */
router.post('/reset-password/:token', resetPassword);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Récupérer l'utilisateur courant
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Utilisateur courant récupéré
 */
router.get('/me', protect, getCurrentUser);

/**
 * @swagger
 * /auth/check:
 *   get:
 *     summary: Vérifie si le token de session est toujours valide
 *     tags: [Auth]
 *     description: Retourne un simple booléen ; utile au front Web pour rafraîchir l'état d'authentification au reload.
 *     responses:
 *       200:
 *         description: Session valide
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 isAuthenticated:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Session expirée ou inexistante
 */
router.get('/check', protect, (req, res) => {
  // Si le middleware 'protect' a validé le token, on renvoie un booléen clair
  res.status(200).json({
    success: true,
    isAuthenticated: true
  });
});

/**
 * @swagger
 * /auth/profile:
 *   put:
 *     summary: Mettre à jour le profil utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profil mis à jour avec succès
 */
router.put('/profile', protect, updateProfile);

// Changer le mot de passe
router.put('/change-password', protect, changePassword);

// Mettre à jour le thème
router.put('/theme', protect, updateTheme);

// Upload avatar
router.put('/avatar', protect, uploadAvatar.single('file'), uploadAvatarHandler);

// Renvoyer l'email de vérification
router.post('/resend-verification', protect, resendVerificationEmail);

// Supprimer le compte et toutes les données associées
router.delete('/account', protect, deleteAccount);

export default router;

