import express, { Router } from 'express';
import * as controller from '../controllers/stripe.js';

const createStripeRouter = () => {
  const router = Router();
  router.post('/webhook', express.raw({ type: 'application/json' }), controller.webhook);
  return router;
};

export { createStripeRouter };
