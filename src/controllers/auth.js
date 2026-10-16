import { HttpError } from '../lib/http.js';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, clearCookie, readCookie, setCookie } from '../lib/session.js';
import { parseName, text } from '../lib/validate.js';
import * as auth from '../services/auth.js';
import { createGoogleAuthRequest, fetchGoogleProfile, statesMatch } from '../services/google.js';

const GOOGLE_COOKIE = 'g_oauth';
const GOOGLE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const normalizeEmail = (value) => text(value).trim().toLowerCase();

const parseEmail = (value) => {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address');
  }
  return email;
};

const parsePassword = (value) => {
  const password = text(value);
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Password must be 8 to 128 characters');
  }
  return password;
};

const parseToken = (value) => {
  const token = text(value);
  if (!token) throw new HttpError(400, 'This link is invalid or has expired');
  return token;
};

const startSession = (res, token) => setCookie(res, SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS);

const signup = async (req, res) => {
  await auth.signup({
    email: parseEmail(req.body?.email),
    password: parsePassword(req.body?.password),
    name: parseName(req.body?.name),
  });
  res.status(201).json({ message: 'Check your email to verify your account' });
};

const verifyEmail = async (req, res) => {
  await auth.verifyEmail(parseToken(req.body?.token));
  res.json({ message: 'Email verified. You can sign in now.' });
};

const resendVerification = async (req, res) => {
  await auth.resendVerification(parseEmail(req.body?.email));
  res.json({ message: 'If that account needs verifying, we sent a new link' });
};

const login = async (req, res) => {
  const { user, token } = await auth.login({
    email: normalizeEmail(req.body?.email),
    password: text(req.body?.password),
  });
  startSession(res, token);
  res.json({ user });
};

const logout = async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await auth.deleteSession(token);
  clearCookie(res, SESSION_COOKIE);
  res.json({ message: 'Signed out' });
};

const me = (req, res) => {
  res.json({ user: req.user });
};

const forgotPassword = async (req, res) => {
  await auth.forgotPassword(parseEmail(req.body?.email));
  res.json({ message: 'If that email has an account, we sent a reset link' });
};

const resetPassword = async (req, res) => {
  await auth.resetPassword({ token: parseToken(req.body?.token), password: parsePassword(req.body?.password) });
  res.json({ message: 'Password updated. You can sign in now.' });
};

const changePassword = async (req, res) => {
  await auth.changePassword({
    userId: req.user.id,
    currentToken: readCookie(req, SESSION_COOKIE),
    currentPassword: text(req.body?.currentPassword),
    newPassword: parsePassword(req.body?.newPassword),
  });
  res.json({ message: 'Password updated' });
};

const googleStart = (req, res) => {
  const { state, verifier, url } = createGoogleAuthRequest();
  setCookie(res, GOOGLE_COOKIE, `${state}.${verifier}`, GOOGLE_COOKIE_MAX_AGE_SECONDS);
  res.redirect(url);
};

const googleCallback = async (req, res) => {
  const [state, verifier] = (readCookie(req, GOOGLE_COOKIE) ?? '').split('.');
  clearCookie(res, GOOGLE_COOKIE);
  try {
    if (!statesMatch(state, req.query.state) || !verifier || typeof req.query.code !== 'string') {
      throw new Error('Invalid Google sign-in state');
    }
    const profile = await fetchGoogleProfile(req.query.code, verifier);
    startSession(res, await auth.signInWithGoogle(profile));
    res.redirect(`${process.env.APP_URL}/`);
  } catch (err) {
    res.redirect(`${process.env.APP_URL}/login?error=${err.reason ?? 'google'}`);
  }
};

export {
  normalizeEmail,
  signup,
  verifyEmail,
  resendVerification,
  login,
  logout,
  me,
  forgotPassword,
  resetPassword,
  changePassword,
  googleStart,
  googleCallback,
};
