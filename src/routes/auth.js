import { Router } from 'express';
import * as controller from '../controllers/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireUser } from '../middleware/requireUser.js';

// Built per app so every createApp() starts with fresh rate-limit counters.
const createAuthRouter = () => {
  const router = Router();
  const perIp = () => rateLimit((req) => req.ip);
  const perEmail = () => rateLimit((req) => controller.normalizeEmail(req.body?.email));

  router.post('/signup', perIp(), controller.signup);
  router.post('/verify-email', controller.verifyEmail);
  router.post('/resend-verification', perIp(), controller.resendVerification);
  router.post('/login', perIp(), perEmail(), controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', requireUser, controller.me);
  router.post('/forgot-password', perIp(), controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);
  router.post('/change-password', requireUser, controller.changePassword);
  router.get('/google', controller.googleStart);
  router.get('/google/callback', controller.googleCallback);

  return router;
};

export { createAuthRouter };
