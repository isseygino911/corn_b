const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

const setCookie = (res, name, value, maxAgeSeconds) => {
  res.cookie(name, value, { ...cookieOptions(), maxAge: maxAgeSeconds * 1000 });
};

const clearCookie = (res, name) => {
  res.clearCookie(name, cookieOptions());
};

const readCookie = (req, name) => {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
};

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, setCookie, clearCookie, readCookie };
