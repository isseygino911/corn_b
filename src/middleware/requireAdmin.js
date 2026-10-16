import { HttpError } from '../lib/http.js';
import { requireUser } from './requireUser.js';

const requireAdmin = [
  requireUser,
  (req, res, next) => next(req.user.isAdmin ? undefined : new HttpError(403, 'Forbidden')),
];

export { requireAdmin };
