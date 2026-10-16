import { Router } from 'express';
import * as controller from '../controllers/orders.js';
import { requireUser } from '../middleware/requireUser.js';

const createOrdersRouter = () => {
  const router = Router();
  router.use(requireUser);
  router.post('/', controller.place);
  router.get('/', controller.list);
  router.get('/:orderNumber', controller.get);
  return router;
};

export { createOrdersRouter };
