import { parseFields, parseName, parseNumericId, parseOptionalString, parseString } from '../lib/validate.js';
import * as addresses from '../services/addresses.js';
import { updateName } from '../services/auth.js';
import { assertRegion } from '../services/geo.js';

const ADDRESS_FIELDS = {
  fullName: parseString('Full name', 80),
  phone: parseString('Phone', 30),
  line1: parseString('Address line 1', 120),
  line2: parseOptionalString('Address line 2', 120),
  countryCode: (value) => parseString('Country', 2)(value).toUpperCase(),
  stateCode: (value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''),
  city: parseString('City', 80),
  postalCode: parseString('Postal code', 20),
};

const addressId = (req) => parseNumericId(req.params.id);

const updateProfile = async (req, res) => res.json({ user: await updateName(req.user.id, parseName(req.body?.name)) });

const listAddresses = async (req, res) => res.json({ addresses: await addresses.list(req.user.id) });

const createAddress = async (req, res) => {
  const fields = parseFields(req.body, ADDRESS_FIELDS);
  assertRegion(fields.countryCode, fields.stateCode);
  res.status(201).json({ address: await addresses.create(req.user.id, fields) });
};

const updateAddress = async (req, res) => {
  const id = addressId(req);
  const fields = parseFields(req.body, ADDRESS_FIELDS, { partial: true });
  if ('countryCode' in fields || 'stateCode' in fields) {
    const current = await addresses.get(req.user.id, id);
    const merged = { ...current, ...fields };
    assertRegion(merged.countryCode, merged.stateCode);
  }
  res.json({ address: await addresses.update(req.user.id, id, fields) });
};

const makeDefaultAddress = async (req, res) =>
  res.json({ address: await addresses.setDefault(req.user.id, addressId(req)) });

const deleteAddress = async (req, res) => {
  await addresses.remove(req.user.id, addressId(req));
  res.json({ message: 'Address deleted' });
};

export { updateProfile, listAddresses, createAddress, updateAddress, makeDefaultAddress, deleteAddress };
