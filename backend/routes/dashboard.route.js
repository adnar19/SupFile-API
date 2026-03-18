import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { getDashboardStats,search } from '../controllers/dashboard.controller.js';

const router = express.Router();

router.get('/', getDashboardStats);
router.get('/search', search);

export default router;
