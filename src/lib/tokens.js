import crypto from 'node:crypto';

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export { randomToken, hashToken };
