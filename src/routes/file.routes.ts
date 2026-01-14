import { Router } from 'express';
import multer from 'multer';
import * as FileController from '../controllers/file.controller';
import { authenticateToken } from '../middlewares/auth.middleware'; // IMPORT ICI

const upload = multer({ dest: 'uploads/' });
const router = Router();

// On ajoute authenticateToken ici. 
// L'ordre est important : 1. Vérifie l'auth -> 2. Reçoit le fichier -> 3. Enregistre
router.post('/upload', authenticateToken, upload.single('file'), FileController.uploadFile);

export default router;