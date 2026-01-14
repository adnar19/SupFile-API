import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/prisma';

export const createFolder = async (req: AuthRequest, res: Response) => {
    try {
        const { name, parentId } = req.body;
        const userId = req.user?.userId;

        if (!userId) return res.status(401).json({ message: "Utilisateur non identifié" });

        const folder = await prisma.folder.create({
            data: {
                name,
                ownerId: userId,
                parentId: parentId || null, // Permet de créer des sous-dossiers
            }
        });

        res.status(201).json(folder);
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la création du dossier" });
    }
};

export const getFolderContent = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const folderId = req.params.id === 'root' ? null : req.params.id;

        const folders = await prisma.folder.findMany({
            where: { ownerId: userId, parentId: folderId, isDeleted: false }
        });

        const files = await prisma.file.findMany({
            where: { ownerId: userId, folderId: folderId, isDeleted: false }
        });

        res.json({ folders, files });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la récupération du contenu" });
    }
};