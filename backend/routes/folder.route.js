import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { createFolder, getFolderContents, deleteFolder } from '../controllers/folder.controller.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         fullName:
 *           type: string
 *         theme:
 *           type: string
 *           enum: [light, dark]
 *         emailVerified:
 *           type: boolean
 *         isActive:
 *           type: boolean
 *         storageUsed:
 *           type: string
 *           description: Espace utilisé en octets (BigInt converti en string)
 *         storageQuota:
 *           type: string
 *           description: Quota total en octets (BigInt converti en string)
 *         avatarUrl:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Folder:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         path:
 *           type: string
 *         parentId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         ownerId:
 *           type: string
 *           format: uuid
 *         isDeleted:
 *           type: boolean
 *         isFavorited:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     File:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         storageName:
 *           type: string
 *         mimeType:
 *           type: string
 *         size:
 *           type: string
 *           description: Taille en octets (BigInt converti en string)
 *         folderId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         ownerId:
 *           type: string
 *           format: uuid
 *         isDeleted:
 *           type: boolean
 *         isFavorited:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * tags:
 *   name: Folders
 *   description: Gestion de l'arborescence des dossiers
 */

router.use(protect);

/**
 * @swagger
 * /folders:
 *   post:
 *     summary: Créer un nouveau dossier
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
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
 *               parentId:
 *                 type: string
 *                 format: uuid
 *                 description: ID du dossier parent (null pour la racine)
 */
router.post('/', createFolder);

/**
 * @swagger
 * /folders/{id}:
 *   get:
 *     summary: Obtenir le contenu d'un dossier (fichiers et sous-dossiers)
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID du dossier ou 'root' pour la racine
 *     responses:
 *       200:
 *         description: Contenu récupéré avec Breadcrumbs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     currentFolder:
 *                       $ref: '#/components/schemas/Folder'
 *                     folders:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Folder'
 *                     files:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/File'
 */
router.get('/:id', getFolderContents);

/**
 * @swagger
 * /folders/{id}:
 *   delete:
 *     summary: Déplacer un dossier dans la corbeille
 *     tags: [Folders]
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
router.delete('/:id', deleteFolder);

export default router;
