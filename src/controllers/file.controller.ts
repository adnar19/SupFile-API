import { Request, Response } from 'express';
import prisma from '../config/prisma';
import fs from 'fs';

export const uploadFile = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        const userId = (req as any).user.userId; // Récupéré via ton futur AuthMiddleware

        if (!file) return res.status(400).json({ message: "Aucun fichier fourni" });

        // 1. Vérifier le quota de l'utilisateur
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const newTotalSize = Number(user?.usedStorage || 0) + file.size;

        if (newTotalSize > Number(user?.storageQuota)) {
            // Supprimer le fichier temporaire si le quota est dépassé
            fs.unlinkSync(file.path); 
            return res.status(403).json({ message: "Quota de stockage dépassé (30 Go max)" });
        }

        // 2. Enregistrer en base de données via Prisma
        const savedFile = await prisma.file.create({
            data: {
                name: file.originalname,
                mimeType: file.mimetype,
                size: BigInt(file.size),
                storagePath: file.path,
                ownerId: userId,
                // folderId: req.body.folderId || null (si upload dans un sous-dossier)
            }
        });

        // 3. Mettre à jour l'espace utilisé par l'utilisateur
        await prisma.user.update({
            where: { id: userId },
            data: { usedStorage: BigInt(newTotalSize) }
        });

        res.status(201).json(savedFile);
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de l'upload" });
    }
};