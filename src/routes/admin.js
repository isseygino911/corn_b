import { Router } from 'express';
import * as controller from '../controllers/admin.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const createAdminRouter = () => {
  const router = Router();
  router.use(requireAdmin);

  router.get('/dashboard', controller.getDashboard);
  router.get('/users', controller.listUsers);

  router.get('/products', controller.listProducts);
  router.post('/products', controller.createProduct);
  router.get('/products/:id', controller.getProduct);
  router.patch('/products/:id', controller.updateProduct);
  router.post('/products/:id/archive', controller.archiveProduct);
  router.post('/products/:id/restore', controller.restoreProduct);
  router.put('/products/:id/images', controller.setProductImages);
  router.post('/uploads', controller.createUpload);

  router.get('/accessories', controller.listAccessories);
  router.post('/accessories', controller.createAccessory);
  router.get('/accessories/:id', controller.getAccessory);
  router.patch('/accessories/:id', controller.updateAccessory);
  router.post('/accessories/:id/archive', controller.archiveAccessory);
  router.post('/accessories/:id/restore', controller.restoreAccessory);

  return router;
};

export { createAdminRouter };
