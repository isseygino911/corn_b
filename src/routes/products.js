import { Router } from 'express';
import * as controller from '../controllers/products.js';

const createProductsRouter = () => {
  const router = Router();
  router.get('/', controller.list);
  router.get('/sold', controller.sold);
  router.get('/:slug', controller.get);
  return router;
};

export { createProductsRouter };
