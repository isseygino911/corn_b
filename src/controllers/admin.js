import { HttpError } from '../lib/http.js';
import { COLLECTIONS } from '../lib/catalog.js';
import { SKU_PATTERN } from '../lib/sku.js';
import {
  parseBoolean,
  parseFields,
  parseInteger,
  parseOneOf,
  parseNumericId,
  parseOptionalString,
  parseString,
  parseUuidList,
  text,
} from '../lib/validate.js';
import * as adminUsers from '../services/adminUsers.js';
import * as catalog from '../services/catalog.js';
import { EXTENSIONS, KEY_PATTERN, MAX_UPLOAD_BYTES, UPLOAD_KINDS, createUploadUrl } from '../services/storage.js';

const MAX_PRICE_CENTS = 100_000_000;
const MAX_STOCK = 1_000_000;
const MAX_IMAGES = 5;
const MAX_PAGE = 10000;

const parseSku = (value) => {
  if (value === undefined || value === '') return undefined;
  const sku = text(value).trim().toUpperCase();
  if (!SKU_PATTERN.test(sku)) throw new HttpError(400, 'SKU must be three letters and at least four digits');
  return sku;
};

const parseSlug = (value) => {
  if (value === undefined || value === '') return undefined;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(text(value)) || value.length > 140) {
    throw new HttpError(400, 'Slug must be lowercase letters, digits and dashes');
  }
  return value;
};

const parseColorway = (value) => {
  if (!/^[a-z0-9-]{1,40}$/.test(text(value))) {
    throw new HttpError(400, 'Colorway must be 1 to 40 lowercase letters, digits or dashes');
  }
  return value;
};

const PRODUCT_FIELDS = {
  name: parseString('Name', 120),
  description: (value) => parseOptionalString('Description', 5000)(value) ?? '',
  collection: parseOneOf('Collection', COLLECTIONS),
  colorway: parseColorway,
  priceCents: parseInteger('Price', { max: MAX_PRICE_CENTS }),
  stock: parseInteger('Stock', { max: MAX_STOCK, fallback: 0 }),
  active: parseBoolean('Active', false),
  sku: parseSku,
  slug: parseSlug,
};

const ACCESSORY_FIELDS = {
  name: parseString('Name', 120),
  description: parseOptionalString('Description', 5000),
  priceCents: parseInteger('Price', { max: MAX_PRICE_CENTS }),
  stock: parseInteger('Stock', { max: MAX_STOCK, fallback: 0 }),
  active: parseBoolean('Active', false),
  imageKey: (value) => (value ? parseImageKey(value) : null),
  sku: parseSku,
};

const parseImageKey = (value) => {
  if (!KEY_PATTERN.test(text(value))) throw new HttpError(400, 'Image key is invalid');
  return value;
};

// Optional fields left out of a create body fall back to a generated value in the service.
const withoutUndefined = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

const parseProductBody = (body, { partial }) => {
  const fields = withoutUndefined(parseFields(body, PRODUCT_FIELDS, { partial }));
  if (body?.accessoryIds !== undefined) fields.accessoryIds = parseUuidList('Accessory')(body.accessoryIds);
  return fields;
};

const parseAccessoryBody = (body, { partial }) => withoutUndefined(parseFields(body, ACCESSORY_FIELDS, { partial }));

const idOf = (req) => parseNumericId(req.params.id);

const archivedFilter = (req) => ({ archived: ['true', '1'].includes(req.query.archived) });

const listProducts = async (req, res) => res.json({ products: await catalog.listProducts(archivedFilter(req)) });

const createProduct = async (req, res) =>
  res.status(201).json({ product: await catalog.createProduct(parseProductBody(req.body, { partial: false })) });

const getProduct = async (req, res) => res.json({ product: await catalog.getProduct(idOf(req)) });

const updateProduct = async (req, res) =>
  res.json({ product: await catalog.updateProduct(idOf(req), parseProductBody(req.body, { partial: true })) });

const archiveProduct = async (req, res) => res.json({ product: await catalog.setArchived('products', idOf(req), true) });

const restoreProduct = async (req, res) => res.json({ product: await catalog.setArchived('products', idOf(req), false) });

const parseImages = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMAGES) {
    throw new HttpError(400, `Provide 1 to ${MAX_IMAGES} images`);
  }
  const images = value.map((image) => ({ key: parseImageKey(image?.key), isMain: image?.isMain === true }));
  if (images.filter((image) => image.isMain).length !== 1) throw new HttpError(400, 'Exactly one image must be main');
  if (new Set(images.map((image) => image.key)).size !== images.length) throw new HttpError(400, 'Duplicate image');
  return images;
};

const setProductImages = async (req, res) =>
  res.json({ product: await catalog.setProductImages(idOf(req), parseImages(req.body)) });

const createUpload = async (req, res) => {
  const { contentType, size, kind = 'product' } = req.body ?? {};
  if (!UPLOAD_KINDS.includes(kind)) throw new HttpError(400, 'Upload kind must be product or accessory');
  if (!Object.hasOwn(EXTENSIONS, contentType)) throw new HttpError(400, 'Images must be JPEG, PNG or WebP');
  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Images must be 5 MB or smaller');
  }
  res.json(await createUploadUrl({ contentType, size, kind }));
};

const listAccessories = async (req, res) => res.json({ accessories: await catalog.listAccessories(archivedFilter(req)) });

const createAccessory = async (req, res) =>
  res.status(201).json({ accessory: await catalog.createAccessory(parseAccessoryBody(req.body, { partial: false })) });

const getAccessory = async (req, res) => res.json({ accessory: await catalog.getAccessory(idOf(req)) });

const updateAccessory = async (req, res) =>
  res.json({ accessory: await catalog.updateAccessory(idOf(req), parseAccessoryBody(req.body, { partial: true })) });

const archiveAccessory = async (req, res) =>
  res.json({ accessory: await catalog.setArchived('accessories', idOf(req), true) });

const restoreAccessory = async (req, res) =>
  res.json({ accessory: await catalog.setArchived('accessories', idOf(req), false) });

const getDashboard = async (req, res) => res.json(await adminUsers.dashboard());

const listUsers = async (req, res) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw new HttpError(400, `Page must be a whole number from 1 to ${MAX_PAGE}`);
  res.json(await adminUsers.listUsers({ q: text(req.query.q).trim(), page }));
};

export {
  getDashboard,
  listUsers,
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
  setProductImages,
  createUpload,
  listAccessories,
  createAccessory,
  getAccessory,
  updateAccessory,
  archiveAccessory,
  restoreAccessory,
};
