import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { createAccountRouter } from './routes/account.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createGeoRouter } from './routes/geo.js';
import { createProductsRouter } from './routes/products.js';

const createApp = () => {
  const app = express();

  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/account', createAccountRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api/products', createProductsRouter());
  app.use('/api/geo', createGeoRouter());

  app.use(errorHandler);

  return app;
};

export { createApp };
