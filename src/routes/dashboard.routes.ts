import { Router } from 'express';
import * as DashboardController from '../controllers/dashboard.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, DashboardController.getUserStats);

export default router;