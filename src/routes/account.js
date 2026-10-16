import { Router } from 'express';
import * as controller from '../controllers/account.js';
import { requireUser } from '../middleware/requireUser.js';

const createAccountRouter = () => {
  const router = Router();
  router.use(requireUser);

  router.patch('/profile', controller.updateProfile);
  router.get('/addresses', controller.listAddresses);
  router.post('/addresses', controller.createAddress);
  router.patch('/addresses/:id', controller.updateAddress);
  router.delete('/addresses/:id', controller.deleteAddress);
  router.post('/addresses/:id/default', controller.makeDefaultAddress);

  return router;
};

export { createAccountRouter };
