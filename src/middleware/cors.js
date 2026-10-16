// Lets the browser app at APP_URL call this API from another origin, with the session cookie.
// Only that one origin is allowed; any other origin gets no CORS headers, so the browser blocks it.
const cors = (req, res, next) => {
  res.vary('Origin');
  if (req.headers.origin !== process.env.APP_URL) return next();
  res.set({
    'Access-Control-Allow-Origin': process.env.APP_URL,
    'Access-Control-Allow-Credentials': 'true',
  });
  if (req.method !== 'OPTIONS') return next();
  res.set({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  });
  res.sendStatus(204);
};

export { cors };
