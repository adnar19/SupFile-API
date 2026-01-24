import { Router } from 'express';
import * as UserController from '../controllers/user.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// GET /api/users/me -> Voir mon profil
router.get('/me', authenticateToken, UserController.getProfile);

// PATCH /api/users/me -> Modifier mon profil
router.patch('/me', authenticateToken, UserController.updateProfile);

export default router;