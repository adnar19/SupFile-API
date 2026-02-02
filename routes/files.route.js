import express from 'express';
import { upload } from '../middlewares/upload.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import prisma from '../lib/prisma.js'; 

const router = express.Router();

router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier n'a été envoyé." });
    }

    // Sauvegarde dans la base de données
    const savedFile = await prisma.file.create({
      data: {
        name: req.file.originalname,           // Nom lisible
        storageName: req.file.filename,        // Nom sur le disque 
        mimeType: req.file.mimetype,           // Type de fichier
        size: BigInt(req.file.size),           // Taille (convertie en BigInt pour Postgres)
        ownerId: req.user.id,                  // L'ID de l'user (injecté par le middleware protect)
        folderId: req.body.folderId || null    // Optionnel : si envoyé dans un dossier précis
      }
    });

    // On renvoie la réponse (en convertissant BigInt en String pour éviter les erreurs JSON)
    res.status(201).json({
      message: "Fichier uploadé et enregistré en base !",
      file: {
        ...savedFile,
        size: savedFile.size.toString()
      }
    });

  } catch (error) {
    console.error("Erreur upload Prisma:", error);
    res.status(500).json({ message: "Erreur lors de l'enregistrement du fichier." });
  }
  // Récupérer tous les fichiers de l'utilisateur connecté
router.get('/my-files', protect, async (req, res) => {
    const files = await prisma.file.findMany({
      where: { ownerId: req.user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' }
    });
    
    // N'oublie pas de convertir les BigInt en String avant d'envoyer
    const safeFiles = files.map(f => ({ ...f, size: f.size.toString() }));
    res.json(safeFiles);
  });
});

export default router;