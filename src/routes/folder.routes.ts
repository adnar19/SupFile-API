import { Router } from 'express';
import * as FolderController from '../controllers/folder.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Créer un dossier : POST /api/folders
router.post('/', authenticateToken, FolderController.createFolder);

// Voir le contenu d'un dossier (ou la racine) : GET /api/folders/:id
router.get('/:id', authenticateToken, FolderController.getFolderContent);

export default router;