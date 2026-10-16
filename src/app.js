import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';

const createApp = () => {
  const app = express();

  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter());

  app.use(errorHandler);

  return app;
};

export { createApp };
