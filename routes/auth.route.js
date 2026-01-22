import express from 'express';
import { signup, signin, signout } from '../controllers/auth.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: API pour l'authentification des utilisateurs
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Enregistrer un nouvel utilisateur
 *     description: Enregistre un nouvel utilisateur avec les informations fournies.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - password
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: "Jean Dupont"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "MotDePasse123!"
 *     responses:
 *       '200':
 *         description: Utilisateur enregistré avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Utilisateur enregistré avec succès"
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "c56a4180-65aa-42ec-a945-5fd21dec0538"
 *                     fullName:
 *                       type: string
 *                       example: "Jean Dupont"
 *                     email:
 *                       type: string
 *                       example: "jean.dupont@example.com"
 *       '400':
 *         description: Erreur lors de l'enregistrement de l'utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Email déjà utilisé"
 *       '500':
 *         description: Erreur serveur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Erreur lors de l'enregistrement de l'utilisateur"
 */
router.post('/register', signup);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Authentifier un utilisateur et générer un token JWT
 *     description: L'utilisateur peut se connecter avec son email ou son username
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "MotDePasse123!"
 *                 description: Le mot de passe de l'utilisateur (au moins 8 caractères, incluant des lettres majuscules, minuscules, chiffres et caractères spéciaux)
 *     responses:
 *       '200':
 *         description: Authentification réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Authentification réussie"
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "a1b2c3d4e5f6g7h8i9j0"
 *                     fullName:
 *                       type: string
 *                       example: "Jean Dupont"
 *                     email:
 *                       type: string
 *                       example: "jean.dupont@example.com"            
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       '400':
 *         description: Erreur lors de l'authentification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Email ou mot de passe incorrect"
 *       '500':
 *         description: Erreur serveur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Erreur lors de l'authentification"
 */
router.post('/login', signin);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Déconnecter un utilisateur en invalidant son token JWT
 *     description: Déconnecte l'utilisateur en supprimant le token JWT côté client.
 *     tags:
 *       - Auth
 *     responses:
 *       '200':
 *         description: Déconnexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Déconnexion réussie"
 *       '500':
 *         description: Erreur lors de la déconnexion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Erreur lors de la déconnexion"
 */
router.post('/logout', signout);
export default router;
