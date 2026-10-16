import crypto from 'node:crypto';
import { randomToken } from '../lib/tokens.js';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Returns the Google consent URL plus the state and PKCE verifier the
// callback must be given back.
const createGoogleAuthRequest = () => {
  const state = randomToken();
  const verifier = randomToken();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { state, verifier, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
};

const statesMatch = (expected, actual) => {
  const a = Buffer.from(expected ?? '');
  const b = Buffer.from(actual ?? '');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Exchanges the code at Google's token endpoint and returns { sub, email, name }
// from the id_token. The token comes straight from Google over TLS, so its
// signature is not re-checked; audience, issuer, expiry and email are.
// Errors carry a `reason` the callback puts in the redirect.
const fetchGoogleProfile = async (code, verifier) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error('Google token exchange failed');
  const { id_token: idToken } = await response.json();
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());

  if (
    claims.aud !== process.env.GOOGLE_CLIENT_ID ||
    !ISSUERS.includes(claims.iss) ||
    !(claims.exp * 1000 > Date.now()) ||
    !claims.sub ||
    !claims.email
  ) {
    throw new Error('Invalid Google id_token');
  }
  if (claims.email_verified !== true) {
    throw Object.assign(new Error('Google email is not verified'), { reason: 'google_unverified' });
  }
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: (claims.name || claims.email.split('@')[0]).slice(0, 80),
  };
};

export { createGoogleAuthRequest, statesMatch, fetchGoogleProfile };
