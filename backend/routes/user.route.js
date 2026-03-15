import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { 
  getUserById, 
  updateUserProfile 
} from '../controllers/user.controller.js';

const router = express.Router();

// Toutes les routes utilisateur sont protégées
router.use(protect);


router.get('/:id', getUserById);

router.put('/:id/profile', updateUserProfile);


export default router;