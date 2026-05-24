import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FileStorageService {
  constructor() {
    // Définir le répertoire de stockage principal
    this.storageDir = path.join(__dirname, '..', 'uploads');
    
    // Créer les sous-répertoires nécessaires
    this.subDirs = {
      profiles: 'profiles',
      documents: 'documents',
      images: 'images',
      temp: 'temp'
    };
    
    this.ensureDirectories();
  }

  // Assurer que tous les répertoires existent
  async ensureDirectories() {
    try {
      // Créer le répertoire principal s'il n'existe pas
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
        console.log(`Created storage directory: ${this.storageDir}`);
      }

      // Créer les sous-répertoires
      Object.values(this.subDirs).forEach(subDir => {
        const fullPath = path.join(this.storageDir, subDir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
          console.log(`Created subdirectory: ${fullPath}`);
        }
      });
    } catch (error) {
      console.error('Error creating directories:', error);
      throw error;
    }
  }

  // Générer un nom de fichier unique
  generateUniqueFileName(originalName, prefix = '') {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    
    const cleanBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    return prefix ? `${prefix}_${cleanBaseName}_${timestamp}_${randomString}${extension}` 
                   : `${cleanBaseName}_${timestamp}_${randomString}${extension}`;
  }

  // Sauvegarder un fichier
  async saveFile(buffer, originalName, subDirType = 'documents', prefix = '') {
    try {
      const fileName = this.generateUniqueFileName(originalName, prefix);
      const targetDir = path.join(this.storageDir, this.subDirs[subDirType]);
      const filePath = path.join(targetDir, fileName);

      // Écrire le fichier
      await fs.promises.writeFile(filePath, buffer);
      
      console.log(`File saved: ${filePath}`);
      
      return {
        success: true,
        fileName,
        filePath,
        relativePath: path.join(this.subDirs[subDirType], fileName),
        size: buffer.length
      };
    } catch (error) {
      console.error('Error saving file:', error);
      throw new Error(`Failed to save file: ${error.message}`);
    }
  }

  // Supprimer un fichier
  async deleteFile(relativePath) {
    try {
      const filePath = path.join(this.storageDir, relativePath);
      
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        console.log(`File deleted: ${filePath}`);
        return true;
      } else {
        console.warn(`File not found for deletion: ${filePath}`);
        return false;
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  // Récupérer un fichier
  async getFile(relativePath) {
    try {
      const filePath = path.join(this.storageDir, relativePath);
      
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }

      const stats = await fs.promises.stat(filePath);
      const buffer = await fs.promises.readFile(filePath);
      
      return {
        success: true,
        buffer,
        size: stats.size,
        mimeType: this.getMimeType(relativePath),
        lastModified: stats.mtime
      };
    } catch (error) {
      console.error('Error getting file:', error);
      throw new Error(`Failed to get file: ${error.message}`);
    }
  }

  // Déterminer le MIME type basé sur l'extension
  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  // Vérifier si un fichier existe
  async fileExists(relativePath) {
    try {
      const filePath = path.join(this.storageDir, relativePath);
      return fs.existsSync(filePath);
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }

  // Obtenir les informations d'un fichier
  async getFileInfo(relativePath) {
    try {
      const filePath = path.join(this.storageDir, relativePath);
      
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }

      const stats = await fs.promises.stat(filePath);
      
      return {
        fileName: path.basename(relativePath),
        relativePath,
        size: stats.size,
        mimeType: this.getMimeType(relativePath),
        createdAt: stats.birthtime,
        lastModified: stats.mtime
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      throw new Error(`Failed to get file info: ${error.message}`);
    }
  }

  // Nettoyer les fichiers temporaires (plus de 24h)
  async cleanupTempFiles() {
    try {
      const tempDir = path.join(this.storageDir, this.subDirs.temp);
      const files = await fs.promises.readdir(tempDir);
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.promises.stat(filePath);
        
        if (now - stats.mtime.getTime() > twentyFourHours) {
          await fs.promises.unlink(filePath);
          console.log(`Cleaned up temp file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }

  // Obtenir le chemin de stockage (utile pour Docker)
  getStoragePath() {
    return this.storageDir;
  }

  // Obtenir l'espace de stockage utilisé
  async getStorageUsage() {
    try {
      let totalSize = 0;
      let fileCount = 0;

      const calculateDirectorySize = async (dirPath) => {
        const items = await fs.promises.readdir(dirPath);
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          const stats = await fs.promises.stat(itemPath);
          
          if (stats.isDirectory()) {
            await calculateDirectorySize(itemPath);
          } else {
            totalSize += stats.size;
            fileCount++;
          }
        }
      };

      await calculateDirectorySize(this.storageDir);
      
      return {
        totalSize,
        fileCount,
        humanReadableSize: this.formatBytes(totalSize)
      };
    } catch (error) {
      console.error('Error calculating storage usage:', error);
      return { totalSize: 0, fileCount: 0, humanReadableSize: '0 B' };
    }
  }

  // Formater les bytes en format lisible
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

export default new FileStorageService();
