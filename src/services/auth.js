import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { SESSION_MAX_AGE_SECONDS } from '../lib/session.js';
import { hashToken, randomToken } from '../lib/tokens.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './mailer.js';

const TOKEN_TTL_SECONDS = { verify: 24 * 60 * 60, reset: 60 * 60 };
const INVALID_LINK = 'This link is invalid or has expired';
const BAD_CREDENTIALS = 'Incorrect email or password';

const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name, isAdmin: Boolean(row.is_admin) });

const findUserByEmail = async (email) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
};

const findUserById = async (id) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
};

// Returns a fresh token and invalidates the user's earlier unused ones of that type.
const issueToken = async (userId, type) => {
  const token = randomToken();
  await withTransaction(async (connection) => {
    await connection.query('UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND type = ? AND used_at IS NULL', [
      userId,
      type,
    ]);
    await connection.query(
      'INSERT INTO auth_tokens (user_id, type, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
      [userId, type, hashToken(token), TOKEN_TTL_SECONDS[type]],
    );
  });
  return token;
};

// Marks a valid token used and returns its user id. Single use.
const consumeToken = async (connection, type, token) => {
  const [rows] = await connection.query(
    'SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE',
    [hashToken(token), type],
  );
  if (!rows[0]) throw new HttpError(400, INVALID_LINK);
  await connection.query('UPDATE auth_tokens SET used_at = NOW() WHERE id = ?', [rows[0].id]);
  return rows[0].user_id;
};

const createSession = async (userId) => {
  const token = randomToken();
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
    [userId, hashToken(token), SESSION_MAX_AGE_SECONDS],
  );
  return token;
};

const updateName = async (userId, name) => {
  await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, userId]);
  return publicUser(await findUserById(userId));
};

const deleteSession = (token) => pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);

// Returns the public user for a live session token, or undefined.
const findUserBySession = async (token) => {
  const [rows] = await pool.query(
    'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > NOW()',
    [hashToken(token)],
  );
  return rows[0] && publicUser(rows[0]);
};

// Mail is sent in the background so a mail outage can't fail the request (or reveal which accounts exist).
const sendQuietly = (send, to, token) =>
  send(to, token).catch((err) => console.error(`Could not send mail to ${to}: ${err.message}`));

const signup = async ({ email, password, name }) => {
  const passwordHash = await hashPassword(password);
  let result;
  try {
    [result] = await pool.query('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [
      email,
      name,
      passwordHash,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account with this email already exists');
    throw err;
  }
  sendQuietly(sendVerificationEmail, email, await issueToken(result.insertId, 'verify'));
};

const verifyEmail = (token) =>
  withTransaction(async (connection) => {
    const userId = await consumeToken(connection, 'verify', token);
    await connection.query('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
  });

const resendVerification = async (email) => {
  const user = await findUserByEmail(email);
  if (user && !user.email_verified) sendQuietly(sendVerificationEmail, email, await issueToken(user.id, 'verify'));
};

// Returns { user, token } for a new session.
const login = async ({ email, password }) => {
  const user = await findUserByEmail(email);
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, BAD_CREDENTIALS);
  }
  if (!user.email_verified) {
    throw new HttpError(403, 'Verify your email before signing in', { code: 'email_not_verified' });
  }
  return { user: publicUser(user), token: await createSession(user.id) };
};

const forgotPassword = async (email) => {
  const user = await findUserByEmail(email);
  if (user) sendQuietly(sendPasswordResetEmail, email, await issueToken(user.id, 'reset'));
};

const resetPassword = async ({ token, password }) => {
  const passwordHash = await hashPassword(password);
  await withTransaction(async (connection) => {
    const userId = await consumeToken(connection, 'reset', token);
    await connection.query('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', [passwordHash, userId]);
    await connection.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  });
};

// Keeps the session identified by currentToken; every other session of the user is revoked.
const changePassword = async ({ userId, currentToken, currentPassword, newPassword }) => {
  const user = await findUserById(userId);
  if (!user.password_hash) throw new HttpError(400, 'This account has no password. Use "Forgot password" to set one.');
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    await connection.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, hashToken(currentToken)]);
  });
};

// Signs in with a verified Google profile, linking to an existing same-email account.
// Linking an unverified password account drops its password: whoever signed up
// with that email has not proven they own it.
const signInWithGoogle = async ({ sub, email, name }) => {
  let [rows] = await pool.query('SELECT * FROM users WHERE google_id = ?', [sub]);
  let user = rows[0];
  if (!user) {
    user = await findUserByEmail(email);
    if (user?.google_id) throw new Error('Email belongs to another Google account');
    if (user) {
      await pool.query(
        'UPDATE users SET google_id = ?, password_hash = IF(email_verified, password_hash, NULL), email_verified = 1 WHERE id = ?',
        [sub, user.id],
      );
    } else {
      [rows] = await pool.query('INSERT INTO users (email, name, google_id, email_verified) VALUES (?, ?, ?, 1)', [
        email,
        name,
        sub,
      ]);
      user = { id: rows.insertId };
    }
  }
  return createSession(user.id);
};

export {
  findUserBySession,
  signup,
  verifyEmail,
  resendVerification,
  login,
  updateName,
  deleteSession,
  forgotPassword,
  resetPassword,
  changePassword,
  signInWithGoogle,
};
