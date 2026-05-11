import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
// npm install archiver

// Helper pour gérer les conflits de noms (ex: "Folder" -> "Folder (1)")
const getUniqueFolderName = async (folderName, parentId, ownerId) => {
  let name = folderName;
  let counter = 1;

  while (true) {
    const existingFolder = await prisma.folder.findFirst({
      where: {
        name: name,
        parentId: parentId,
        ownerId: ownerId,
        isDeleted: false
      }
    });

    if (!existingFolder) return name;

    name = `${folderName} (${counter})`;
    counter++;
  }
};

// ============================================
// CREATE FOLDER
// ============================================
export const createFolder = async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.user.id;

    if (!name) {
      throw ErrorTypes.BadRequest('Le nom du dossier est requis');
    }

    let parentPath = '';
    let finalParentId = parentId;

    // If parentId is provided, verify it exists and belongs to user
    if (parentId) {
      const parentFolder = await prisma.folder.findUnique({
        where: { id: parentId }
      });

      if (!parentFolder) throw ErrorTypes.NotFound('Dossier parent introuvable');
      
      // Si je ne suis pas le propriétaire, je dois avoir une permission d'écriture
      if (parentFolder.ownerId !== userId) {
        const shares = await prisma.internalShare.findMany({
          where: { sharedWithId: userId, permission: 'WRITE' },
          include: { folder: true }
        });
        
        // On vérifie si le dossier parent fait partie d'une arborescence partagée en écriture
        const hasWriteAccess = shares.some(s => parentFolder.path.startsWith(s.folder.path));
        if (!hasWriteAccess) throw ErrorTypes.Forbidden("Vous n'avez pas la permission d'écrire dans ce dossier.");
      }

      parentPath = parentFolder.path;
    } else {
      // If no parentId, try to find the root folder
      const rootFolder = await prisma.folder.findFirst({
        where: { ownerId: userId, parentId: null }
      });
      if (rootFolder) {
        finalParentId = rootFolder.id;
        parentPath = rootFolder.path;
      }
    }

    // Gestion des conflits de nom
    const uniqueName = await getUniqueFolderName(name, finalParentId, userId);

    const folder = await prisma.folder.create({
      data: {
        name: uniqueName,
        path: `${parentPath}/${uniqueName}`,
        parentId: finalParentId,
        ownerId: userId
      }
    });

    res.status(201).json({
      success: true,
      message: 'Dossier créé avec succès',
      data: folder
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET FOLDER CONTENTS (Navigation)
// ============================================
export const getFolderContents = async (req, res, next) => {
  try {
    const { id } = req.params; // Can be 'root' or a UUID
    const userId = req.user.id;

    let currentFolder;

    // Handle "root" alias
    if (id === 'root') {
      currentFolder = await prisma.folder.findFirst({
        where: { ownerId: userId, parentId: null }
      });
      
      // Fallback: Create root if it doesn't exist (safety net)
      if (!currentFolder) {
        currentFolder = await prisma.folder.create({
          data: { name: 'My Files', ownerId: userId, path: '/My Files' }
        });
      }
    } else {
      currentFolder = await prisma.folder.findUnique({
        where: { id }
      });
      
      if (!currentFolder || currentFolder.ownerId !== userId) {
        // Vérification si c'est un dossier partagé (ou un sous-dossier d'un partage)
        // 1. Vérification directe (le dossier racine partagé)
        const directShare = await prisma.internalShare.findUnique({
          where: { folderId_sharedWithId: { folderId: id, sharedWithId: userId } }
        });

        // 2. Vérification héritée (sous-dossier)
        // On cherche tous les partages de l'utilisateur et on regarde si le chemin correspond
        const allUserShares = await prisma.internalShare.findMany({
          where: { 
            sharedWithId: userId,
            folder: { isDeleted: false } // SÉCURITÉ : Ignorer les partages provenant de dossiers supprimés
          },
          include: { folder: { select: { path: true } } }
        });

        const isChildOfShare = allUserShares.some(share => currentFolder && currentFolder.path.startsWith(share.folder.path + '/'));

        if (!directShare && !isChildOfShare) {
           throw ErrorTypes.NotFound('Dossier introuvable ou accès refusé');
        }
      }
    }

    // Fetch subfolders and files in parallel
    const [folders, files] = await Promise.all([
      prisma.folder.findMany({
        where: { 
          parentId: currentFolder.id, 
          ownerId: currentFolder.ownerId, // CORRECTION : Utiliser l'ID du propriétaire du dossier (pour voir les fichiers partagés)
          isDeleted: false 
        },
        include: {
          favorites: { where: { userId } }
        },
        orderBy: { name: 'asc' }
      }),
      prisma.file.findMany({
        where: { 
          folderId: currentFolder.id, 
          ownerId: currentFolder.ownerId, // CORRECTION : Idem pour les fichiers
          isDeleted: false 
        },
        include: {
          favorites: { where: { userId } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Build Breadcrumbs (Ancestors) - Optimized version
    const pathParts = currentFolder.path.split('/').filter(p => p);
    const ancestorPaths = pathParts.map((part, index) => {
      return '/' + pathParts.slice(0, index + 1).join('/');
    });

    const breadcrumbsData = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        path: { in: ancestorPaths }
      },
      select: { id: true, name: true, path: true },
    });

    // Sort breadcrumbs correctly based on path depth
    const breadcrumbs = breadcrumbsData.sort((a, b) => a.path.length - b.path.length);

    // Pagination logic
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const formattedFolders = folders.map(f => {
      const { favorites, ...folderData } = f;
      return { ...folderData, type: 'folder', isFavorited: favorites.length > 0 };
    });

    const formattedFiles = files.map(f => {
      const { favorites, ...fileData } = f;
      return { ...fileData, type: 'file', size: f.size.toString(), isFavorited: favorites.length > 0 };
    });

    // Combine them (folders first, then files)
    const combined = [...formattedFolders, ...formattedFiles];

    const totalItems = combined.length;
    const totalPages = Math.ceil(totalItems / limit);
    const paginatedItems = combined.slice(skip, skip + limit);

    const paginatedFolders = paginatedItems.filter(item => item.type === 'folder');
    const paginatedFiles = paginatedItems.filter(item => item.type === 'file');

    res.status(200).json({
      success: true,
      data: {
        currentFolder,
        breadcrumbs,
        folders: paginatedFolders,
        files: paginatedFiles
      },
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
// DELETE FOLDER (Soft Delete)
// ============================================
export const deleteFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id } });

    if (!folder || folder.ownerId !== userId) {
      throw ErrorTypes.NotFound('Dossier introuvable');
    }

    if (!folder.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de supprimer récursivement.');
    }

    // Suppression récursive (Soft Delete)
    // On utilise une transaction pour garantir que tout ou rien n'est supprimé
    await prisma.$transaction(async (tx) => {
      // 1. Identifier tous les sous-dossiers (le dossier cible + ses descendants)
      // On utilise le chemin (path) pour trouver les descendants efficacement
      const foldersToDelete = await tx.folder.findMany({
        where: {
          ownerId: userId,
          OR: [
            { id: id }, // Le dossier lui-même
            { path: { startsWith: `${folder.path}/` } } // Ses enfants (ex: /Parent/Enfant)
          ]
        },
        select: { id: true }
      });

      const folderIds = foldersToDelete.map(f => f.id);

      // 2. Marquer les dossiers comme supprimés
      await tx.folder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: true }
      });

      // 3. Marquer les fichiers contenus dans ces dossiers comme supprimés
      await tx.file.updateMany({
        where: { folderId: { in: folderIds } },
        data: { isDeleted: true }
      });
    });

    res.status(200).json({
      success: true,
      message: 'Dossier et son contenu déplacés dans la corbeille'
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RENAME FOLDER
// ============================================
export const renameFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) throw ErrorTypes.BadRequest("Le nom est requis");

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    // Mise à jour du chemin pour le dossier et ses enfants
    // Note: C'est une opération coûteuse si l'arborescence est profonde.
    // Pour simplifier ici, on met juste à jour le nom. 
    // Dans un système de production avec "path" matérialisé, il faudrait mettre à jour tous les enfants :
    // oldPath: /A/OldName -> newPath: /A/NewName
    // child: /A/OldName/B -> /A/NewName/B

    const oldPath = folder.path;
    const newPath = oldPath.substring(0, oldPath.lastIndexOf('/')) + '/' + name;

    await prisma.$transaction(async (tx) => {
      // 1. Renommer le dossier
      await tx.folder.update({
        where: { id },
        data: { name, path: newPath }
      });

      // 2. Mettre à jour les chemins des enfants (SQL brut souvent plus simple pour le remplacement de chaîne)
      // Ici on le fait en JS pour rester agnostique, mais attention aux perfs sur gros volumes
      const children = await tx.folder.findMany({
        where: { 
          ownerId: userId,
          path: { startsWith: oldPath + '/' } 
        }
      });

      for (const child of children) {
        const childNewPath = newPath + child.path.substring(oldPath.length);
        await tx.folder.update({
          where: { id: child.id },
          data: { path: childNewPath }
        });
      }
    });

    res.status(200).json({ success: true, message: "Dossier renommé" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// MOVE FOLDER
// ============================================
export const moveFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body; // null pour root
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    let newPathPrefix = '';
    let finalParentId = parentId;

    if (parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: parentId } });
      if (!parent || parent.ownerId !== userId) throw ErrorTypes.BadRequest("Dossier de destination invalide");
      
      // Empêcher le déplacement d'un dossier dans lui-même ou ses enfants
      if (parent.path.startsWith(folder.path)) {
         throw ErrorTypes.BadRequest("Impossible de déplacer un dossier dans lui-même");
      }
      newPathPrefix = parent.path;
    } else {
      // Déplacement vers la racine (My Files)
      const rootFolder = await prisma.folder.findFirst({ where: { ownerId: userId, parentId: null } });
      if (rootFolder) {
        finalParentId = rootFolder.id;
        newPathPrefix = rootFolder.path;
      }
    }

    const oldPath = folder.path;
    const newPath = `${newPathPrefix}/${folder.name}`;

    await prisma.$transaction(async (tx) => {
      // 1. Déplacer le dossier
      await tx.folder.update({
        where: { id },
        data: { parentId: finalParentId, path: newPath }
      });

      // 2. Mettre à jour les chemins des enfants
      const children = await tx.folder.findMany({
        where: { ownerId: userId, path: { startsWith: oldPath + '/' } }
      });

      for (const child of children) {
        const childNewPath = newPath + child.path.substring(oldPath.length);
        await tx.folder.update({
          where: { id: child.id },
          data: { path: childNewPath }
        });
      }
    });

    res.status(200).json({ success: true, message: "Dossier déplacé" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RESTORE FOLDER
// ============================================
export const restoreFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const folderToRestore = await prisma.folder.findUnique({
      where: { id, ownerId: userId },
      include: { parent: true } // Include parent to check its status
    });

    if (!folderToRestore) {
      throw ErrorTypes.NotFound("Dossier introuvable ou vous n'avez pas les permissions.");
    }

    if (!folderToRestore.isDeleted) {
      return res.status(400).json({ success: false, message: "Le dossier n'est pas dans la corbeille." });
    }

    if (!folderToRestore.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de restaurer récursivement.');
    }

    // Empêche la restauration si le dossier parent est lui-même dans la corbeille.
    if (folderToRestore.parent && folderToRestore.parent.isDeleted) {
      throw ErrorTypes.BadRequest("Impossible de restaurer ce dossier car son dossier parent est dans la corbeille. Veuillez d'abord restaurer le dossier parent.");
    }

    // Utilisation d'une transaction pour une restauration atomique
    await prisma.$transaction(async (tx) => {
      // 1. Trouver tous les sous-dossiers (y compris le dossier actuel) à restaurer
      const foldersToRestore = await tx.folder.findMany({
        where: {
          ownerId: userId,
          path: { startsWith: folderToRestore.path }
        },
        select: { id: true }
      });

      const folderIdsToRestore = foldersToRestore.map(f => f.id);

      // 2. Restaurer tous les dossiers et fichiers identifiés
      await tx.folder.updateMany({ where: { id: { in: folderIdsToRestore } }, data: { isDeleted: false } });
      await tx.file.updateMany({ where: { folderId: { in: folderIdsToRestore } }, data: { isDeleted: false } });
    });

    res.status(200).json({
      success: true,
      message: "Dossier et son contenu restaurés avec succès."
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DOWNLOAD FOLDER (ZIP)
// ============================================
export const downloadFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const rootFolder = await prisma.folder.findUnique({ where: { id } });
    if (!rootFolder || rootFolder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    if (!rootFolder.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de générer l\'archive.');
    }

    // 1. Récupérer tous les fichiers et sous-dossiers récursivement
    const folders = await prisma.folder.findMany({
      where: { 
        ownerId: userId,
        isDeleted: false,
        OR: [{ id: id }, { path: { startsWith: rootFolder.path + '/' } }]
      }
    });
    
    const folderIds = folders.map(f => f.id);
    const files = await prisma.file.findMany({
      where: { 
        folderId: { in: folderIds },
        isDeleted: false
      }
    });

    // 2. Préparer l'archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.attachment(`${rootFolder.name}.zip`);
    archive.pipe(res);

    // 3. Ajouter les structures de dossiers (pour s'assurer que les dossiers vides sont inclus)
    for (const folder of folders) {
      if (folder.id === rootFolder.id) continue;

      // Calculer le chemin relatif par rapport au dossier racine téléchargé
      const relativePath = folder.path.substring(rootFolder.path.length + 1);
      archive.append(null, { name: relativePath + '/' });
    }

    // 3. Ajouter les fichiers à l'archive en reconstruisant la structure
    for (const file of files) {
      const physicalPath = path.join(process.cwd(), 'uploads', file.storageName);
      
      if (fs.existsSync(physicalPath)) {
        // Trouver le dossier parent de ce fichier pour déterminer son chemin relatif dans le ZIP
        const parentFolder = folders.find(f => f.id === file.folderId);
        let relativePath = file.name;

        if (parentFolder && parentFolder.id !== rootFolder.id) {
          // Calculer le chemin relatif par rapport au dossier racine téléchargé
          // Ex: Root=/A, File=/A/B/file.txt -> relative = B/file.txt
          const folderPart = parentFolder.path.substring(rootFolder.path.length + 1); // +1 pour le slash
          relativePath = path.join(folderPart, file.name);
        }

        archive.file(physicalPath, { name: relativePath });
      }
    }

    await archive.finalize();

  } catch (error) {
    next(error);
  }
};