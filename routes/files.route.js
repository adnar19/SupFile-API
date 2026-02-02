import express from 'express';
import { upload } from '../middlewares/upload.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import prisma from '../lib/prisma.js'; 

const router = express.Router();

// ============================================
// ROUTE POST : UPLOAD
// ============================================
router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier n'a été envoyé." });
    }

    const savedFile = await prisma.file.create({
      data: {
        name: req.file.originalname,
        storageName: req.file.filename,
        mimeType: req.file.mimetype,
        size: BigInt(req.file.size),
        ownerId: req.user.id,
        folderId: req.body.folderId || null
      }
    });

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
}); // <--- L'accolade de fin du POST était ici !

// ============================================
// ROUTE GET : LISTE (Bien séparée maintenant)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const files = await prisma.file.findMany({
      where: { ownerId: req.user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' }
    });
    
    const safeFiles = files.map(f => ({ ...f, size: f.size.toString() }));
    res.json(safeFiles);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des fichiers." });
  }
});

export default router;