import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import path from 'path';
import fs from 'fs';

// Helper pour gérer les conflits de noms (ex: "file.txt" -> "file (1).txt")
const getUniqueFileName = async (fileName, folderId, ownerId) => {
  let name = fileName;
  let counter = 1;
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);

  while (true) {
    const existingFile = await prisma.file.findFirst({
      where: {
        name: name,
        folderId: folderId, // null ou ID du dossier
        ownerId: ownerId,
        isDeleted: false
      }
    });

    if (!existingFile) return name;

    name = `${baseName} (${counter})${ext}`;
    counter++;
  }
};

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
    let finalFolderId = req.body.folderId || null;

    // Validation du dossier parent si fourni
    if (finalFolderId) {
      const folder = await prisma.folder.findUnique({ where: { id: finalFolderId } });
      if (!folder || folder.ownerId !== user.id) {
        throw ErrorTypes.BadRequest("Dossier de destination invalide");
      }
    } else {
      // Si upload à la racine, on rattache au dossier "My Files" pour la cohérence
      const rootFolder = await prisma.folder.findFirst({ where: { ownerId: user.id, parentId: null } });
      if (rootFolder) {
        finalFolderId = rootFolder.id;
      }
    }

    // Gestion des conflits de nom
    const uniqueName = await getUniqueFileName(req.file.originalname, finalFolderId, user.id);

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
          name: uniqueName,
          storageName: req.file.filename,
          mimeType: req.file.mimetype,
          size: fileSize,
          ownerId: user.id,
          folderId: finalFolderId
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
// PREVIEW FILE (Lecture directe: Images, Vidéos, PDF)
// ============================================
export const previewFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const file = await prisma.file.findUnique({
      where: { id: id }
    });

    if (!file || file.ownerId !== req.user.id || file.isDeleted) {
      throw ErrorTypes.NotFound("Fichier non trouvé ou accès refusé.");
    }

    const filePath = path.join(process.cwd(), 'uploads', file.storageName);

    if (!fs.existsSync(filePath)) {
      throw ErrorTypes.NotFound("Le fichier physique est introuvable.");
    }

    // 'inline' indique au navigateur d'essayer d'afficher le contenu
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', 'inline');

    // res.sendFile gère automatiquement les "Range requests" pour le streaming vidéo
    res.sendFile(filePath);
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

    if (!file || file.ownerId !== req.user.id || file.isDeleted) {
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

    // Gestion des conflits de nom dans le dossier de destination
    const uniqueName = await getUniqueFileName(name, file.folderId, req.user.id);

    const updatedFile = await prisma.file.update({
      where: { id },
      data: { name: uniqueName }
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

    let finalFolderId = folderId;

    if (folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.ownerId !== req.user.id) throw ErrorTypes.BadRequest("Dossier de destination invalide");
    } else {
      // Si aucun dossier cible (drop à la racine), on assigne le dossier racine (My Files)
      const rootFolder = await prisma.folder.findFirst({ where: { ownerId: req.user.id, parentId: null } });
      if (rootFolder) {
        finalFolderId = rootFolder.id;
      }
    }

    // Gestion des conflits de nom dans le dossier de destination
    const uniqueName = await getUniqueFileName(file.name, finalFolderId, req.user.id);

    const updatedFile = await prisma.file.update({
      where: { id },
      data: { folderId: finalFolderId || null, name: uniqueName }
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
    const userId = req.user.id;

    const fileToRestore = await prisma.file.findUnique({
      where: { id, ownerId: userId },
      include: { folder: true } // Inclure le dossier parent
    });

    if (!fileToRestore) {
      throw ErrorTypes.NotFound("Fichier introuvable ou accès refusé.");
    }

    if (!fileToRestore.isDeleted) {
      return res.status(400).json({ success: false, message: "Le fichier n'est pas dans la corbeille." });
    }

    // Empêcher la restauration si le dossier parent est lui-même dans la corbeille.
    if (fileToRestore.folder && fileToRestore.folder.isDeleted) {
      throw ErrorTypes.BadRequest("Impossible de restaurer ce fichier car son dossier parent est dans la corbeille. Veuillez d'abord restaurer le dossier parent.");
    }

    await prisma.file.update({ where: { id }, data: { isDeleted: false } });

    res.status(200).json({ success: true, message: "Fichier restauré avec succès." });
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