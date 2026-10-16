import { Router } from 'express';
import * as controller from '../controllers/geo.js';

const createGeoRouter = () => {
  const router = Router();
  router.get('/countries', controller.countries);
  router.get('/states', controller.states);
  router.get('/cities', controller.cities);
  return router;
};

export { createGeoRouter };
