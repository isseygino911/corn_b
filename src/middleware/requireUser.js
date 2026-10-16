import { HttpError } from '../lib/http.js';
import { SESSION_COOKIE, readCookie } from '../lib/session.js';
import { findUserBySession } from '../services/auth.js';

// Loads the user on every request so admin changes and revoked sessions apply at once.
const requireUser = async (req, res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  const user = token && (await findUserBySession(token));
  if (!user) throw new HttpError(401, 'Not authenticated');
  req.user = user;
  next();
};

export { requireUser };
