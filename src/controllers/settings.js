import { parseBoolean, parseFields, parseInteger, parseNumericId } from '../lib/validate.js';
import * as settings from '../services/settings.js';
import * as shipping from '../services/shipping.js';
import { parseCountryCode } from './checkout.js';

const MAX_SHIPPING_CENTS = 100_000_000;

const SETTINGS_FIELDS = {
  shippingEnabled: parseBoolean('Shipping enabled'),
};

// A null or empty country is the default row for any other country.
const RATE_FIELDS = {
  countryCode: (value) => (value == null || value === '' ? null : parseCountryCode(value)),
  priceCents: parseInteger('Price', { max: MAX_SHIPPING_CENTS }),
  active: parseBoolean('Active', true),
};

const getSettings = async (req, res) => res.json({ settings: await settings.getSettings() });

const updateSettings = async (req, res) =>
  res.json({ settings: await settings.updateSettings(parseFields(req.body, SETTINGS_FIELDS, { partial: true })) });

const listRates = async (req, res) => res.json({ shippingRates: await shipping.list() });

const createRate = async (req, res) =>
  res.status(201).json({ shippingRate: await shipping.create(parseFields(req.body, RATE_FIELDS)) });

const updateRate = async (req, res) =>
  res.json({ shippingRate: await shipping.update(parseNumericId(req.params.id), parseFields(req.body, RATE_FIELDS, { partial: true })) });

const deleteRate = async (req, res) => {
  await shipping.remove(parseNumericId(req.params.id));
  res.status(204).end();
};

export { getSettings, updateSettings, listRates, createRate, updateRate, deleteRate };
