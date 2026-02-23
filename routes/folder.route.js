import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { createFolder, getFolderContents, deleteFolder } from '../controllers/folder.controller.js';

const router = express.Router();

router.use(protect);

router.post('/', createFolder);
router.get('/:id', getFolderContents); // Use 'root' to get the top level folder
router.delete('/:id', deleteFolder);

export default router;
