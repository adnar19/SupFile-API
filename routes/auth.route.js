// Dans routes/auth.route.js
import express from 'express';
import { 
  signup, 
  signin, 
  signout,
  firebaseOAuthCallback,
  verifyEmail,
  resendVerificationEmail,
  getCurrentUser
} from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/register', signup); // On lie l'URL /register à la fonction signup
router.post('/login', signin);    // On lie l'URL /login à la fonction signin
router.post('/logout', signout);

/**
 * @swagger
 * /auth/oauth/callback:
 *   post:
 *     summary: Authentification OAuth (Google, Microsoft, GitHub)
 *     description: Authentifie un utilisateur via Firebase OAuth. Crée automatiquement un compte si nécessaire. Email vérifié et compte actif automatiquement.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firebaseToken
 *               - provider
 *             properties:
 *               firebaseToken:
 *                 type: string
 *                 description: Token JWT Firebase obtenu après authentification OAuth
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFkYzBmM..."
 *               provider:
 *                 type: string
 *                 enum: [google, microsoft, github]
 *                 description: Provider OAuth utilisé
 *                 example: "google"
 *     responses:
 *       '200':
 *         description: Authentification OAuth réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 statusCode:
 *                   type: number
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Connexion réussie"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         fullName:
 *                           type: string
 *                         emailVerified:
 *                           type: boolean
 *                           example: true
 *                         isActive:
 *                           type: boolean
 *                           example: true
 *                         oauthProvider:
 *                           type: string
 *                           example: "google"
 *                     token:
 *                       type: string
 *                     isNewUser:
 *                       type: boolean
 *                       description: Indique si c'est un nouveau compte
 *       '400':
 *         description: Token Firebase manquant ou provider invalide
 *       '409':
 *         description: Compte existant avec un autre provider
 */
router.post('/oauth/callback', firebaseOAuthCallback);

/**
 * @swagger
 * /auth/verify-email/{token}:
 *   get:
 *     summary: Vérifier l'adresse email
 *     description: Vérifie l'email de l'utilisateur avec le token reçu par email. Active automatiquement le compte.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token de vérification envoyé par email
 *     responses:
 *       '200':
 *         description: Email vérifié avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 statusCode:
 *                   type: number
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Email vérifié avec succès. Votre compte est maintenant actif."
 *                 data:
 *                   type: object
 *                   properties:
 *                     emailVerified:
 *                       type: boolean
 *                       example: true
 *                     isActive:
 *                       type: boolean
 *                       example: true
 *       '400':
 *         description: Token invalide, déjà utilisé ou expiré
 */
router.get('/verify-email/:token', verifyEmail);

/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Renvoyer l'email de vérification
 *     description: Renvoie un nouvel email de vérification à l'utilisateur connecté
 *     tags:
 *       - Auth
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Email de vérification renvoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 statusCode:
 *                   type: number
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Email de vérification renvoyé"
 *       '400':
 *         description: Email déjà vérifié
 *       '401':
 *         description: Non authentifié
 */
router.post('/resend-verification', protect, resendVerificationEmail);


/**
 * @swagger
 * components:
 *   securitySchemes:
 *     cookieAuth:
 *       type: apiKey
 *       in: cookie
 *       name: token
 */

export default router;