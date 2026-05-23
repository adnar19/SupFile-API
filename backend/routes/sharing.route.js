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
  getSharedWithMe,
  updateSharePermission
} from '../controllers/sharing.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Sharing
 *   description: Liens publics et partages internes collaboratifs
 */

// ============================================
// Routes Protégées — Liens publics (Specific routes BEFORE parameterized ones)
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

// ============================================
// Routes Publiques (Catch-all parameterized routes - must be AFTER specific routes)
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
 *     summary: Partager un dossier ou un fichier avec un autre utilisateur
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, type, email]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [file, folder]
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
 *     summary: Révoquer un partage interne (Fichier ou Dossier)
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, type, email]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [file, folder]
 *               email:
 *                 type: string
 */
router.delete('/internal', protect, removeInternalShare);            // Révoquer un partage

/**
 * @swagger
 * /share/internal/{shareId}/permission:
 *   patch:
 *     summary: Modifier les permissions d'un partage interne
 *     description: Met à jour les permissions (READ ou WRITE) pour un partage interne existant.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: shareId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permission]
 *             properties:
 *               permission:
 *                 type: string
 *                 enum: [READ, WRITE]
 *                 description: Nouvelle permission à appliquer
 *     responses:
 *       200:
 *         description: Permission mise à jour avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/internal/:shareId/permission', protect, updateSharePermission);  // Modifier les permissions

/**
 * @swagger
 * /share/internal/list:
 *   get:
 *     summary: Lister les éléments partagés avec moi
 *     description: Récupère tous les fichiers et dossiers auxquels l'utilisateur a accès via un partage interne.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des éléments partagés récupérée avec succès
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
 *                       type:
 *                         type: string
 *                         enum: [file, folder]
 *                       item:
 *                         type: object
 *                         description: Détails du fichier ou dossier
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
 * /share/internal/{itemId}/shares:
 *   get:
 *     summary: Lister les collaborateurs d'un élément
 *     description: Récupère la liste des utilisateurs ayant accès à un fichier ou dossier spécifique.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de l'élément (file ou folder).
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [file, folder]
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