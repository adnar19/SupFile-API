import express from 'express';
import { upload } from '../middlewares/upload.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadFile, getUserFiles, downloadFile, renameFile, moveFile, deleteFile, restoreFile, getTrash, replaceFile, deletePermanently, emptyTrash } from '../controllers/file.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Files
 *   description: Gestion des fichiers (Upload, Rename, Trash, etc.)
 */

// Routes de gestion des fichiers

/**
 * @swagger
 * /files/upload:
 *   post:
 *     summary: Uploader un fichier
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               folderId:
 *                 type: string
 *                 format: uuid
 */
router.post('/upload', protect, upload.single('file'), uploadFile);

/**
 * @swagger
 * /files:
 *   get:
 *     summary: Récupérer tous les fichiers de l'utilisateur
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des fichiers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/File'
 */
router.get('/', protect, getUserFiles);

/**
 * @swagger
 * /files/trash:
 *   get:
 *     summary: Lister le contenu de la corbeille
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 */
router.get('/trash', protect, getTrash);

/**
 * @swagger
 * /files/download/{id}:
 *   get:
 *     summary: Télécharger un fichier
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 */
router.get('/download/:id', protect, downloadFile);

/**
 * @swagger
 * /files/{id}/rename:
 *   put:
 *     summary: Renommer un fichier
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 */
router.put('/:id/rename', protect, renameFile);

/**
 * @swagger
 * /files/{id}/move:
 *   put:
 *     summary: Déplacer un fichier
 *     tags: [Files]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parentId]
 *             properties:
 *               parentId:
 *                 type: string
 *                 format: uuid
 */
router.put('/:id/move', protect, moveFile);

/**
 * @swagger
 * /files/{id}/restore:
 *   put:
 *     summary: Restaurer un fichier de la corbeille
 *     tags: [Files]
 */
router.put('/:id/restore', protect, restoreFile);

/**
 * @swagger
 * /files/{id}/content:
 *   put:
 *     summary: Remplacer le contenu d'un fichier (nouvelle version)
 *     tags: [Files]
 */
router.put('/:id/content', protect, upload.single('file'), replaceFile);

/**
 * @swagger
 * /files/trash/empty:
 *   delete:
 *     summary: Vider la corbeille
 *     tags: [Files]
 */
router.delete('/trash/empty', protect, emptyTrash);

/**
 * @swagger
 * /files/{id}/permanent:
 *   delete:
 *     summary: Suppression définitive
 *     tags: [Files]
 */
router.delete('/:id/permanent', protect, deletePermanently);

/**
 * @swagger
 * /files/{id}:
 *   delete:
 *     summary: Déplacer un fichier vers la corbeille
 *     tags: [Files]
 */
router.delete('/:id', protect, deleteFile);

export default router;
