// Dans routes/auth.route.js
import express from 'express';
import { signin, signup, signout, verifyEmail } from '../controllers/auth.controller.js'; 
// Importe ton middleware de protection
import { protect } from '../middlewares/auth.middleware.js'; 

const router = express.Router();

// Routes publiques
router.post('/register', signup); 
router.post('/login', signin);    
router.get('/verify-email/:token', verifyEmail);

// Route de vérification de validité (pour Postman et le Frontend)
// Si le token est invalide, 'protect' renverra directement { valid: false }
router.get('/check-token', protect, (req, res) => {
  res.status(200).json({ valid: true });
});

// Route protégée
router.post('/logout', protect, signout);

export default router;