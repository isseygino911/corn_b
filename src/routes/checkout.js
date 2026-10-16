import { Router } from 'express';
import * as controller from '../controllers/checkout.js';
import { rateLimit } from '../middleware/rateLimit.js';

// Quotes are public and recomputed as the cart changes, so the budget is far above the auth routes'.
const QUOTES_PER_WINDOW = 300;

const createCheckoutRouter = () => {
  const router = Router();
  router.get('/settings/storefront', controller.getStorefrontSettings);
  router.post('/checkout/quote', rateLimit((req) => req.ip, QUOTES_PER_WINDOW), controller.createQuote);
  return router;
};

export { createCheckoutRouter };
