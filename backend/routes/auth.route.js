import express from 'express';
import { 
  signup, 
  signout, 
  verifyEmail,  
  OauthSignup,
  // OauthSignin, // Commenté pour éviter le crash si non défini
  forgotPassword,
  resetPassword
} from '../controllers/auth.controller.js'; 
import { authLimiter } from '../middlewares/rateLimit.middleware.js';
import { protect } from '../middlewares/auth.middleware.js'; 

const router = express.Router();

/**
 * @swagger
 * /auth/check:
 *   get:
 *     summary: Vérifie si le token est toujours valide
 *     tags: [Auth]
 */
router.get('/check', protect, (req, res) => {
  // On renvoie un simple succès booléen si le middleware 'protect' a validé le token
  res.status(200).json({
    success: true,
    isAuthenticated: true // Le check est maintenant un booléen clair
  });
});

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 */
router.post('/register', authLimiter, signup);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Connexion utilisateur
 */
// Ton camarade a fusionné signin dans signup, donc on pointe vers signup
router.post('/login', authLimiter, signup); 

/**
 * @swagger
 * /auth/oauth/signin:
 */
// Commenté pour stopper le crash "OauthSignin is not defined"
// router.post('/oauth/signin', OauthSignin);

/**
 * @swagger
 * /auth/oauth/signup:
 */
router.post('/oauth/signup', OauthSignup);

router.post('/logout', signout);
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', resetPassword);

export default router;