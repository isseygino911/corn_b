import { Router } from 'express';
import * as controller from '../controllers/products.js';

const createProductsRouter = () => {
  const router = Router();
  router.get('/', controller.list);
  router.get('/:slug', controller.get);
  router.post('/:slug/quote', controller.createQuote);
  return router;
};

export { createProductsRouter };
