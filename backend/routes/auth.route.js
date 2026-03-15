import express from 'express';
import { 
  signin, 
  signup, 
  signout, 
  verifyEmail, 
  OauthSignin, 
  OauthSignup,
  forgotPassword,
  resetPassword
} from '../controllers/auth.controller.js'; 
import { authLimiter } from '../middlewares/rateLimit.middleware.js';

const router = express.Router();

router.post('/register', authLimiter, signup);
router.post('/login', authLimiter, signin);
router.post('/oauth/signin', OauthSignin);
router.post('/oauth/signup', OauthSignup);
router.post('/logout', signout);
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', resetPassword);

export default router;