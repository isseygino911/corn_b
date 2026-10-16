import { HttpError } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value) => (typeof value === 'string' ? value : '');

const parseString = (label, max) => (value) => {
  const string = text(value).trim();
  if (!string || string.length > max) throw new HttpError(400, `${label} must be 1 to ${max} characters`);
  return string;
};

const parseOptionalString = (label, max) => (value) => (text(value).trim() ? parseString(label, max)(value) : null);

const parseInteger = (label, { max, fallback }) => (value) => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new HttpError(400, `${label} must be a whole number from 0 to ${max}`);
  }
  return value;
};

const parseBoolean = (label, fallback) => (value) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be true or false`);
  return value;
};

const parseOneOf = (label, allowed) => (value) => {
  if (!allowed.includes(value)) throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}`);
  return value;
};

const parseUuid = (label) => (value) => {
  if (!UUID.test(text(value))) throw new HttpError(400, `${label} is invalid`);
  return value.toLowerCase();
};

const parseUuidList = (label) => (value) => {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be a list`);
  return [...new Set(value.map(parseUuid(label)))];
};

// Ids in URLs are numeric row ids; anything else cannot match a row.
const parseNumericId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Not found');
  return id;
};

const parseName = parseString('Name', 80);

// Runs each parser in `specs` ({ field: parser }) over `body`. A partial parse skips absent fields.
const parseFields = (body, specs, { partial = false } = {}) =>
  Object.fromEntries(
    Object.entries(specs)
      .filter(([key]) => !(partial && body?.[key] === undefined))
      .map(([key, parse]) => [key, parse(body?.[key])]),
  );

export {
  UUID,
  text,
  parseString,
  parseOptionalString,
  parseInteger,
  parseBoolean,
  parseOneOf,
  parseUuid,
  parseUuidList,
  parseNumericId,
  parseName,
  parseFields,
};
