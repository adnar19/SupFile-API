import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { 
  createPublicLink,
  deletePublicLink,
  getMyPublicLinks,
  getPublicShareInfo, 
  accessPublicShare, 
  shareFolderInternal, 
  getFolderShares,
  removeInternalShare,
  getSharedWithMe 
} from '../controllers/sharing.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Sharing
 *   description: Liens publics et partages internes collaboratifs
 */

// ============================================
// Routes Publiques (Accessibles sans être connecté)
// ============================================

/**
 * @swagger
 * /share/public/{token}:
 *   get:
 *     summary: Obtenir les infos d'un partage public
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/public/:token', getPublicShareInfo);

/**
 * @swagger
 * /share/public/{token}/download:
 *   post:
 *     summary: Accéder au contenu public (avec mdp si requis)
 *     tags: [Sharing]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 */
router.post('/public/:token/download', accessPublicShare);

// ============================================
// Routes Protégées — Liens publics
// ============================================

/**
 * @swagger
 * /share/public/create:
 *   post:
 *     summary: Créer un lien de partage public
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, type]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [file, folder]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *               password:
 *                 type: string
 */
router.post('/public/create', protect, createPublicLink);

/**
 * @swagger
 * /share/public/my-links:
 *   get:
 *     summary: Lister mes liens publics actifs
 *     description: Récupère la liste de tous les liens de partage publics créés par l'utilisateur connecté.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des liens publics récupérée avec succès.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                         description: ID interne du lien de partage.
 *                       token:
 *                         type: string
 *                         description: Jeton unique utilisé pour accéder au lien public.
 *                       link:
 *                         type: string
 *                         format: url
 *                         description: URL complète du lien de partage public.
 *                       type:
 *                         type: string
 *                         enum: [file, folder]
 *                         description: Type de l'élément partagé (fichier ou dossier).
 *                       item:
 *                         type: object
 *                         description: Détails de l'élément partagé (fichier ou dossier).
 *                       isPasswordProtected:
 *                         type: boolean
 *                         description: Indique si le lien est protégé par un mot de passe.
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                         description: Date et heure d'expiration du lien, si défini.
 *                       views:
 *                         type: integer
 *                         description: Nombre de fois où le lien a été consulté.
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         description: Date et heure de création du lien.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/public/my-links', protect, getMyPublicLinks);          // Liste de mes liens

/**
 * @swagger
 * /share/public/{token}:
 *   delete:
 *     summary: Révoquer un lien public
 *     tags: [Sharing]
 */
router.delete('/public/:token', protect, deletePublicLink);          // Révoquer un lien

// ============================================
// Routes Protégées — Partage interne
// ============================================

/**
 * @swagger
 * /share/internal:
 *   post:
 *     summary: Partager un dossier avec un autre utilisateur
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [folderId, email]
 *             properties:
 *               folderId:
 *                 type: string
 *                 format: uuid
 *               email:
 *                 type: string
 *               permission:
 *                 type: string
 *                 enum: [READ, WRITE]
 */
router.post('/internal', protect, shareFolderInternal);              // Partager (+ permission)

/**
 * @swagger
 * /share/internal:
 *   delete:
 *     summary: Révoquer un partage interne
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [folderId, email]
 *             properties:
 *               folderId:
 *                 type: string
 *                 format: uuid
 *               email:
 *                 type: string
 */
router.delete('/internal', protect, removeInternalShare);            // Révoquer un partage

/**
 * @swagger
 * /share/internal/list:
 *   get:
 *     summary: Lister les dossiers partagés avec moi
 *     description: Récupère tous les dossiers auxquels l'utilisateur connecté a accès via un partage interne.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des dossiers partagés récupérée avec succès
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       sharedBy:
 *                         type: object
 *                         properties:
 *                           fullName:
 *                             type: string
 *                           email:
 *                             type: string
 *                       sharedAt:
 *                         type: string
 *                         format: date-time
 *                       permission:
 *                         type: string
 *                         enum: [READ, WRITE]
 */
router.get('/internal/list', protect, getSharedWithMe);              // "Partagés avec moi"

/**
 * @swagger
 * /share/internal/{folderId}/shares:
 *   get:
 *     summary: Lister les collaborateurs d'un dossier
 *     description: Récupère la liste des utilisateurs avec qui un dossier spécifique est partagé, ainsi que leurs permissions.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID du dossier dont on veut lister les partages.
 *     responses:
 *       200:
 *         description: Liste des partages récupérée avec succès
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
 *                     type: object
 *                     properties:
 *                       shareId:
 *                         type: string
 *                         format: uuid
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           email:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           avatarUrl:
 *                             type: string
 *                             nullable: true
 *                       permission:
 *                         type: string
 *                         enum: [READ, WRITE]
 *                       sharedAt:
 *                         type: string
 *                         format: date-time
 */
router.get('/internal/:folderId/shares', protect, getFolderShares);  // Collaborateurs d'un dossier

export default router;