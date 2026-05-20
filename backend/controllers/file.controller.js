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

    const fileSize = BigInt(req.file?.size || 0);
    const user = req.user;
    let finalFolderId = req.body.folderId || null;

    // Validation du dossier parent si fourni
    if (finalFolderId) {
      const folder = await prisma.folder.findUnique({ where: { id: finalFolderId } });
      if (!folder) throw ErrorTypes.BadRequest("Dossier de destination invalide");

      if (folder.ownerId !== user.id) {
        const shares = await prisma.internalShare.findMany({
          where: { sharedWithId: user.id, permission: 'WRITE' },
          include: { folder: true }
        });
        const hasWriteAccess = shares.some(s => folder.path.startsWith(s.folder.path));
        if (!hasWriteAccess) throw ErrorTypes.Forbidden("Vous n'avez pas la permission d'uploader ici.");
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
    const currentUsage = BigInt(user.storageUsed || 0);
    const quota = BigInt(user.storageQuota || 0);

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
// REPLACE FILE CONTENT (Upload nouvelle version)
// ============================================
export const replaceFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.file) throw ErrorTypes.BadRequest('Aucun fichier fourni');

    const file = await prisma.file.findUnique({
      where: { id },
      include: { folder: true }
    });

    if (!file || file.isDeleted) throw ErrorTypes.NotFound("Fichier introuvable");

    // 1. Vérification des permissions (Propriétaire OU Collaborateur avec écriture)
    let hasAccess = false;
    if (file.ownerId === userId) {
      hasAccess = true;
    } else if (file.folderId) {
      const shares = await prisma.internalShare.findMany({
        where: { sharedWithId: userId, permission: 'WRITE' },
        include: { folder: true }
      });
      // On vérifie si le fichier est dans un dossier partagé en écriture
      hasAccess = shares.some(s => file.folder.path.startsWith(s.folder.path));
    }

    if (!hasAccess) throw ErrorTypes.Forbidden("Permission refusée : Vous ne pouvez pas modifier ce fichier.");

    // 2. Gestion du Quota (Sur le quota du PROPRIÉTAIRE du fichier)
    const newSize = BigInt(req.file.size);
    const oldSize = BigInt(file.size);
    const owner = await prisma.user.findUnique({ where: { id: file.ownerId } });
    
    const newStorageUsed = BigInt(owner.storageUsed) - oldSize + newSize;

    if (newStorageUsed > BigInt(owner.storageQuota)) {
      fs.unlinkSync(req.file.path); // Supprimer le fichier temporaire
      throw ErrorTypes.Forbidden("Le quota de stockage du propriétaire serait dépassé.");
    }

    // 3. Remplacement physique (Suppression de l'ancien)
    const oldPath = path.join(process.cwd(), 'uploads', file.storageName);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch(e) { console.error("Erreur suppression ancien fichier:", e); }
    }

    // 4. Mise à jour DB (Transaction pour fichier et quota propriétaire)
    const [updatedFile] = await prisma.$transaction([
      prisma.file.update({
        where: { id },
        data: {
          storageName: req.file.filename,
          mimeType: req.file.mimetype,
          size: newSize,
          updatedAt: new Date() // Force la mise à jour de la date pour le tri "Récents"
        }
      }),
      prisma.user.update({
        where: { id: file.ownerId },
        data: { storageUsed: newStorageUsed }
      })
    ]);

    res.status(200).json({ 
      success: true, 
      message: "Nouvelle version uploadée", 
      data: { ...updatedFile, size: updatedFile.size.toString() } 
    });

  } catch (error) {
    // Nettoyage si erreur
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(error);
  }
};

// ============================================
// LIST FILES
// ============================================
export const getUserFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [files, totalItems] = await prisma.$transaction([
      prisma.file.findMany({
        where: { ownerId: userId, isDeleted: false },
        include: {
          favorites: { where: { userId } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.file.count({
        where: { ownerId: userId, isDeleted: false }
      })
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      success: true,
      data: files.map(f => ({ 
        ...f, 
        size: f.size.toString(),
        isFavorite: f.favorites && f.favorites.length > 0
      })),
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        limit
      }
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [folders, files] = await prisma.$transaction([
      prisma.folder.findMany({
        where: { ownerId: userId, isDeleted: true },
      }),
      prisma.file.findMany({
        where: { ownerId: userId, isDeleted: true },
      })
    ]);

    // Combine folders and files, adding a type flag
    const combined = [
      ...folders.map(f => ({ ...f, type: 'folder' })),
      ...files.map(f => ({ ...f, type: 'file', size: f.size.toString() }))
    ];

    // Sort by updatedAt descending
    combined.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const totalItems = combined.length;
    const totalPages = Math.ceil(totalItems / limit);
    const paginatedItems = combined.slice(skip, skip + limit);

    // Separate back into folders and files for the frontend format
    const paginatedFolders = paginatedItems.filter(item => item.type === 'folder');
    const paginatedFiles = paginatedItems.filter(item => item.type === 'file');

    res.status(200).json({ 
      success: true, 
      data: { folders: paginatedFolders, files: paginatedFiles },
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        limit
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PERMANENT DELETE (Suppression physique)
// ============================================
export const deletePermanently = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const file = await prisma.file.findFirst({
      where: { id, ownerId: userId, isDeleted: true }
    });

    if (!file) throw ErrorTypes.NotFound("Fichier introuvable dans la corbeille");

    const filePath = path.join(process.cwd(), 'uploads', file.storageName);

    await prisma.$transaction(async (tx) => {
      // 1. Supprimer de la base de données
      await tx.file.delete({ where: { id } });

      // 2. Mettre à jour le quota de l'utilisateur
      await tx.user.update({
        where: { id: userId },
        data: { storageUsed: { decrement: file.size } }
      });
    });

    // 3. Supprimer le fichier physique
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.status(200).json({ success: true, message: "Fichier supprimé définitivement" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// EMPTY TRASH (Vider la corbeille)
// ============================================
export const emptyTrash = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const filesToDelete = await prisma.file.findMany({
      where: { ownerId: userId, isDeleted: true }
    });

    if (filesToDelete.length === 0) {
      return res.status(200).json({ success: true, message: "La corbeille est déjà vide" });
    }

    const totalSize = filesToDelete.reduce((acc, file) => acc + file.size, BigInt(0));

    await prisma.$transaction([
      prisma.file.deleteMany({ where: { ownerId: userId, isDeleted: true } }),
      prisma.folder.deleteMany({ where: { ownerId: userId, isDeleted: true } }),
      prisma.user.update({
        where: { id: userId },
        data: { storageUsed: { decrement: totalSize } }
      })
    ]);

    // Nettoyage physique
    filesToDelete.forEach(file => {
      const filePath = path.join(process.cwd(), 'uploads', file.storageName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    res.status(200).json({ success: true, message: "Corbeille vidée avec succès" });
  } catch (error) {
    next(error);
  }
};