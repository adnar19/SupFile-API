import express from 'express';
// Ajoute verifyEmail (ou le nom exact défini dans ton controller) ici :
import { signin, signup, signout, verifyEmail } from '../controllers/auth.controller.js'; 

const router = express.Router();

router.post('/register', signup); 
router.post('/login', signin);    
router.post('/logout', signout);

router.get('/verify-email/:token', verifyEmail);

export default router;