// Dans routes/auth.route.js
import express from 'express';
// On utilise signin et signup car c'est comme ça qu'ils sont nommés dans ton controller
import { signin, signup, signout, verifyEmail } from '../controllers/auth.controller.js'; 

const router = express.Router();

router.post('/register', signup); // On lie l'URL /register à la fonction signup
router.post('/login', signin);    // On lie l'URL /login à la fonction signin
router.post('/logout', signout);
router.get('/verify-email/:token', verifyEmail);

export default router;