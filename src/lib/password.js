import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// Stored as "<salt hex>:<key hex>".
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
};

const verifyPassword = async (password, stored) => {
  const [salt, key] = stored.split(':');
  const expected = Buffer.from(key, 'hex');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
};

export { hashPassword, verifyPassword };
