import { Router } from 'express';
import * as AuthController from '../controllers/auth.controller';

const router = Router();

// Inscription : POST /api/auth/register
router.post('/register', AuthController.register);

// Connexion : POST /api/auth/login
router.post('/login', AuthController.login);

export default router;