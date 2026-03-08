import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import path from 'path';
import fs from 'fs';

// ============================================
// UPLOAD FILE (Avec gestion du Quota)
// ============================================
export const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      throw ErrorTypes.BadRequest('Aucun fichier fourni');
    }

    const fileSize = BigInt(req.file.size);
    const user = req.user;

    // Validation du dossier parent si fourni
    if (req.body.folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: req.body.folderId } });
      if (!folder || folder.ownerId !== user.id) {
        throw ErrorTypes.BadRequest("Dossier de destination invalide");
      }
    }

    // 1. Vérification du Quota
    const currentUsage = BigInt(user.storageUsed);
    const quota = BigInt(user.storageQuota);

    if (currentUsage + fileSize > quota) {
      // Supprimer le fichier physique si le quota est dépassé
      fs.unlinkSync(req.file.path);
      throw ErrorTypes.Forbidden('Quota de stockage dépassé (30 Go max).');
    }

    // 2. Transaction : Enregistrer le fichier ET mettre à jour l'espace utilisé
    const [savedFile, updatedUser] = await prisma.$transaction([
      prisma.file.create({
        data: {
          name: req.file.originalname,
          storageName: req.file.filename,
          mimeType: req.file.mimetype,
          size: fileSize,
          ownerId: user.id,
          folderId: req.body.folderId || null
        }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          storageUsed: currentUsage + fileSize
        }
      })
    ]);

    res.status(201).json({
      success: true,
      message: 'Fichier uploadé avec succès',
      data: {
        file: { ...savedFile, size: savedFile.size.toString() },
        storageUsed: updatedUser.storageUsed.toString()
      }
    });

  } catch (error) {
    // Nettoyage si erreur (fichier orphelin)
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

// ============================================
// LIST FILES
// ============================================
export const getUserFiles = async (req, res, next) => {
  try {
    const files = await prisma.file.findMany({
      where: { 
        ownerId: req.user.id,
        isDeleted: false 
      },
      orderBy: { createdAt: 'desc' }
    });

    const safeFiles = files.map(f => ({ ...f, size: f.size.toString() }));
    
    res.status(200).json({
      success: true,
      count: safeFiles.length,
      data: safeFiles
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DOWNLOAD FILE
// ============================================
export const downloadFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const file = await prisma.file.findUnique({
      where: { id: id }
    });

    if (!file || file.ownerId !== req.user.id) {
      throw ErrorTypes.NotFound("Fichier non trouvé ou accès refusé.");
    }

    const filePath = path.join(process.cwd(), 'uploads', file.storageName);

    if (!fs.existsSync(filePath)) {
      throw ErrorTypes.NotFound("Le fichier physique est introuvable.");
    }

    res.download(filePath, file.name);
  } catch (error) {
    next(error);
  }
};

// ============================================
// RENAME FILE
// ============================================
export const renameFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) throw ErrorTypes.BadRequest("Le nouveau nom est requis");

    const file = await prisma.file.findUnique({ where: { id } });
    if (!file || file.ownerId !== req.user.id) throw ErrorTypes.NotFound("Fichier introuvable");

    const updatedFile = await prisma.file.update({
      where: { id },
      data: { name }
    });

    res.status(200).json({ success: true, message: "Fichier renommé", data: { ...updatedFile, size: updatedFile.size.toString() } });
  } catch (error) {
    next(error);
  }
};

// ============================================
// MOVE FILE
// ============================================
export const moveFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body; // null pour la racine, ou un UUID

    const file = await prisma.file.findUnique({ where: { id } });
    if (!file || file.ownerId !== req.user.id) throw ErrorTypes.NotFound("Fichier introuvable");

    if (folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.ownerId !== req.user.id) throw ErrorTypes.BadRequest("Dossier de destination invalide");
    }

    const updatedFile = await prisma.file.update({
      where: { id },
      data: { folderId: folderId || null }
    });

    res.status(200).json({ success: true, message: "Fichier déplacé", data: { ...updatedFile, size: updatedFile.size.toString() } });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DELETE FILE (Soft Delete)
// ============================================
export const deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Vérification de propriété implicite via updateMany ou findFirst avant update.
    // Ici on utilise updateMany pour s'assurer que l'ownerId correspond sans faire 2 requêtes
    const result = await prisma.file.updateMany({
      where: { id, ownerId: req.user.id },
      data: { isDeleted: true }
    });

    if (result.count === 0) throw ErrorTypes.NotFound("Fichier introuvable ou accès refusé");

    res.status(200).json({ success: true, message: "Fichier déplacé dans la corbeille" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RESTORE FILE
// ============================================
export const restoreFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await prisma.file.updateMany({
      where: { id, ownerId: req.user.id },
      data: { isDeleted: false }
    });

    if (result.count === 0) throw ErrorTypes.NotFound("Fichier introuvable");

    res.status(200).json({ success: true, message: "Fichier restauré" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET TRASH (Corbeille)
// ============================================
export const getTrash = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [folders, files] = await prisma.$transaction([
      prisma.folder.findMany({
        where: { ownerId: userId, isDeleted: true },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.file.findMany({
        where: { ownerId: userId, isDeleted: true },
        orderBy: { updatedAt: 'desc' }
      })
    ]);

    res.status(200).json({ success: true, data: { folders, files: files.map(f => ({ ...f, size: f.size.toString() })) } });
  } catch (error) {
    next(error);
  }
};
