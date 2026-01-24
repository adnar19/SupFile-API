import express from 'express';
import { 
  signup, 
  signin, 
  verifyEmail, 
  resendVerificationEmail,
  getCurrentUser,
  signout
} from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Routes publiques
router.post('/register', signup);
router.post('/login', signin);
router.get('/verify-email/:token', verifyEmail);

// Routes protégées (nécessitent d'être connecté)
router.get('/me', protect, getCurrentUser);
router.post('/resend-verification', protect, resendVerificationEmail);
router.post('/logout', signout);

// Note: firebaseOAuthCallback est retiré temporairement 
// pour stabiliser ton authentification classique.

export default router;