import express from 'express';
import { uploadFile, getUserFiles } from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { upload } from '../middlewares/upload.middleware.js';

const router = express.Router();

// POST /files/upload -> Upload un fichier
router.post('/upload', protect, upload.single('file'), uploadFile);

// GET /files -> Liste les fichiers de l'utilisateur
router.get('/', protect, getUserFiles);

export default router;