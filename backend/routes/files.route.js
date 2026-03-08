import express from 'express';
import { upload } from '../middlewares/upload.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadFile, getUserFiles, downloadFile, renameFile, moveFile, deleteFile, restoreFile, getTrash } from '../controllers/file.controller.js';

const router = express.Router();

// Routes de gestion des fichiers
router.post('/upload', protect, upload.single('file'), uploadFile);
router.get('/', protect, getUserFiles);
router.get('/trash', protect, getTrash); // Route pour lister la corbeille
router.get('/download/:id', protect, downloadFile);
router.put('/:id/rename', protect, renameFile);
router.put('/:id/move', protect, moveFile);
router.put('/:id/restore', protect, restoreFile); // Route pour restaurer
router.delete('/:id', protect, deleteFile);

export default router;
