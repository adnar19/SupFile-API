import { Router } from 'express';
import * as ShareController from '../controllers/share.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Créer un lien public : POST /api/shares/public
router.post('/public', authenticateToken, ShareController.createPublicLink);

// Partager avec un collègue : POST /api/shares/internal
router.post('/internal', authenticateToken, ShareController.shareWithUser);

export default router;