import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

// ============================================
// HELPER : Récupération récursive des sous-dossiers par ID
// (Évite d'utiliser startsWith sur le path, plus sûr)
// ============================================
const getSubFolderIds = async (folderId, ownerId) => {
  const allFolderIds = [folderId];
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await prisma.folder.findMany({
      where: { parentId: currentId, ownerId, isDeleted: false },
      select: { id: true }
    });
    for (const child of children) {
      allFolderIds.push(child.id);
      queue.push(child.id);
    }
  }

  return allFolderIds;
};

// ============================================
// PUBLIC LINKS (Génération)
// ============================================
export const createPublicLink = async (req, res, next) => {
  try {
    const { itemId, type, expiresAt, password } = req.body;
    const userId = req.user.id;

    if (!itemId || !['file', 'folder'].includes(type)) {
      throw ErrorTypes.BadRequest("Type ou ID invalide.");
    }

    // Vérification de propriété
    if (type === 'file') {
      const file = await prisma.file.findUnique({ where: { id: itemId } });
      if (!file || file.ownerId !== userId) throw ErrorTypes.NotFound("Fichier introuvable.");
    } else {
      const folder = await prisma.folder.findUnique({ where: { id: itemId } });
      if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");
    }

    const token = nanoid(10);
    let passwordHash = null;

    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const shareData = {
      token,
      ownerId: userId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      password: passwordHash,
    };

    if (type === 'file') shareData.fileId = itemId;
    else shareData.folderId = itemId;

    const share = await prisma.publicShare.create({ data: shareData });

    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/share/${token}`;

    res.status(201).json({ success: true, data: { link, token, expiresAt: share.expiresAt } });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Suppression / Révocation)
// ============================================
export const deletePublicLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const share = await prisma.publicShare.findUnique({ where: { token } });

    if (!share) throw ErrorTypes.NotFound("Lien introuvable.");
    if (share.ownerId !== userId) throw ErrorTypes.Forbidden("Vous n'êtes pas propriétaire de ce lien.");

    await prisma.publicShare.delete({ where: { token } });

    res.status(200).json({ success: true, message: "Lien public révoqué avec succès." });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Liste des liens d'un utilisateur)
// ============================================
export const getMyPublicLinks = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const shares = await prisma.publicShare.findMany({
      where: { ownerId: userId },
      include: {
        file: { select: { id: true, name: true, mimeType: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = shares.map(s => ({
      id: s.id,
      token: s.token,
      link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/share/${s.token}`,
      type: s.fileId ? 'file' : 'folder',
      item: s.fileId ? s.file : s.folder,
      isPasswordProtected: !!s.password,
      expiresAt: s.expiresAt,
      views: s.views,
      createdAt: s.createdAt
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Accès & Info)
// ============================================
export const getPublicShareInfo = async (req, res, next) => {
  try {
    const { token } = req.params;
    const share = await prisma.publicShare.findUnique({
      where: { token },
      include: { file: true, folder: true, owner: { select: { fullName: true } } }
    });

    if (!share) throw ErrorTypes.NotFound("Lien invalide ou expiré.");

    // Vérification expiration AVANT tout retour de données
    if (share.expiresAt && new Date() > share.expiresAt) {
      throw ErrorTypes.Forbidden("Ce lien de partage a expiré.");
    }

    const isPasswordProtected = !!share.password;

    if (isPasswordProtected) {
      return res.status(200).json({
        success: true,
        data: {
          isPasswordProtected: true,
          owner: share.owner.fullName
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        isPasswordProtected: false,
        type: share.fileId ? 'file' : 'folder',
        item: share.fileId
          ? { ...share.file, size: share.file.size.toString() }
          : share.folder,
        owner: share.owner.fullName
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Téléchargement avec mot de passe)
// ============================================
export const accessPublicShare = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const share = await prisma.publicShare.findUnique({
      where: { token },
      include: { file: true, folder: true }
    });

    if (!share) throw ErrorTypes.NotFound("Lien introuvable.");
    if (share.expiresAt && new Date() > share.expiresAt) throw ErrorTypes.Forbidden("Lien expiré.");

    // Vérification mot de passe
    if (share.password) {
      if (!password) throw ErrorTypes.Unauthorized("Mot de passe requis.");
      const match = await bcrypt.compare(password, share.password);
      if (!match) throw ErrorTypes.Unauthorized("Mot de passe incorrect.");
    }

    // Incrémenter les vues
    await prisma.publicShare.update({ where: { id: share.id }, data: { views: { increment: 1 } } });

    if (share.fileId) {
      const filePath = path.join(process.cwd(), 'uploads', share.file.storageName);
      if (!fs.existsSync(filePath)) throw ErrorTypes.NotFound("Fichier physique introuvable.");
      res.download(filePath, share.file.name);

    } else if (share.folderId) {
      const folder = share.folder;

      // CORRECTION : Récupération récursive par ID (plus sûre que startsWith sur le path)
      const folderIds = await getSubFolderIds(folder.id, share.ownerId);
      const subFolders = await prisma.folder.findMany({
        where: { id: { in: folderIds }, isDeleted: false }
      });

      const files = await prisma.file.findMany({
        where: { folderId: { in: folderIds }, isDeleted: false }
      });

      const archive = archiver('zip', { zlib: { level: 9 } });
      res.attachment(`${folder.name}.zip`);
      archive.pipe(res);

      for (const f of files) {
        const pPath = path.join(process.cwd(), 'uploads', f.storageName);
        if (fs.existsSync(pPath)) {
          const parentF = subFolders.find(sf => sf.id === f.folderId);
          let relativePath = f.name;
          if (parentF && parentF.id !== folder.id) {
            relativePath = path.join(parentF.path.substring(folder.path.length + 1), f.name);
          }
          archive.file(pPath, { name: relativePath });
        }
      }
      await archive.finalize();
    }

  } catch (error) {
    next(error);
  }
};

// ============================================
// INTERNAL SHARING (Partager un dossier)
// ============================================
export const shareFolderInternal = async (req, res, next) => {
  try {
    // CORRECTION : Ajout du paramètre permission (READ par défaut)
    const { folderId, email, permission = 'READ' } = req.body;
    const userId = req.user.id;

    if (!email || !folderId) throw ErrorTypes.BadRequest("Email et dossier requis.");

    // Validation de la valeur de permission
    if (!['READ', 'WRITE'].includes(permission)) {
      throw ErrorTypes.BadRequest("Permission invalide. Valeurs acceptées : READ, WRITE.");
    }

    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");

    const recipient = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!recipient) throw ErrorTypes.NotFound("Utilisateur destinataire introuvable.");

    if (recipient.id === userId) throw ErrorTypes.BadRequest("Vous ne pouvez pas partager avec vous-même.");

    // Vérifier si déjà partagé
    const existingShare = await prisma.internalShare.findUnique({
      where: { folderId_sharedWithId: { folderId, sharedWithId: recipient.id } }
    });

    if (existingShare) {
      // CORRECTION : Si déjà partagé mais avec une permission différente, on la met à jour
      if (existingShare.permission !== permission) {
        await prisma.internalShare.update({
          where: { id: existingShare.id },
          data: { permission }
        });
        return res.status(200).json({
          success: true,
          message: `Permission mise à jour en ${permission} pour ${recipient.fullName || recipient.email}.`
        });
      }
      return res.status(200).json({ success: true, message: "Déjà partagé avec cet utilisateur avec la même permission." });
    }

    await prisma.internalShare.create({
      data: {
        folderId,
        sharedById: userId,
        sharedWithId: recipient.id,
        permission  // CORRECTION : Enregistrement de la permission choisie
      }
    });

    res.status(201).json({
      success: true,
      message: `Dossier partagé avec ${recipient.fullName || recipient.email} (${permission})`
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// INTERNAL SHARING (Liste des collaborateurs d'un dossier)
// ============================================
export const getFolderShares = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");

    const shares = await prisma.internalShare.findMany({
      where: { folderId },
      include: {
        sharedWith: { select: { id: true, email: true, fullName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const formatted = shares.map(s => ({
      shareId: s.id,
      user: s.sharedWith,
      permission: s.permission,
      sharedAt: s.createdAt
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ============================================
// REMOVE INTERNAL SHARE (Arrêter le partage)
// ============================================
export const removeInternalShare = async (req, res, next) => {
  try {
    const { folderId, email } = req.body;
    const userId = req.user.id;

    if (!folderId || !email) throw ErrorTypes.BadRequest("ID du dossier et email de l'utilisateur requis.");

    const recipient = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!recipient) throw ErrorTypes.NotFound("Utilisateur introuvable.");

    const share = await prisma.internalShare.findUnique({
      where: { folderId_sharedWithId: { folderId, sharedWithId: recipient.id } }
    });

    if (!share) throw ErrorTypes.NotFound("Ce partage n'existe pas.");

    if (share.sharedById !== userId) throw ErrorTypes.Forbidden("Vous n'êtes pas l'auteur de ce partage.");

    await prisma.internalShare.delete({ where: { id: share.id } });

    res.status(200).json({ success: true, message: `Accès révoqué pour ${recipient.email}` });
  } catch (error) {
    next(error);
  }
};

// ============================================
// LIST SHARED WITH ME
// ============================================
export const getSharedWithMe = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const shares = await prisma.internalShare.findMany({
      where: {
        sharedWithId: userId,
        folder: { isDeleted: false }
      },
      include: {
        folder: true,
        sharedBy: { select: { fullName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = shares.map(share => ({
      ...share.folder,
      sharedBy: share.sharedBy,
      sharedAt: share.createdAt,
      isShared: true,
      permission: share.permission
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};