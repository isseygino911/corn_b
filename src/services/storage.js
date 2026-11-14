import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_TTL_SECONDS = 5 * 60;
const READ_TTL_SECONDS = 2 * 60 * 60;
const IS_TEST = process.env.NODE_ENV === 'test';
const TEST_PUBLIC_BASE_URL = 'https://cdn.test';
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const KEY_PREFIXES = { product: 'products', accessory: 'accessories' };
const UPLOAD_KINDS = Object.keys(KEY_PREFIXES);
const KEY_PATTERN = /^(products|accessories)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

let client;
// Region comes from AWS_REGION. The checksum option keeps the SDK from signing a checksum of an empty body into the URL.
const s3 = () => (client ??= new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' }));

const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest();

// Signed GET link for a private object (AWS Signature V4, query auth), signed locally so views stay synchronous.
// The signing time is floored to the hour, so a link is stable within the hour (browsers can cache it) and valid for 1-2 hours.
const signedReadUrl = (key, now = new Date()) => {
  if (IS_TEST) return `${TEST_PUBLIC_BASE_URL}/${key}`;
  const { S3_BUCKET: bucket, AWS_REGION: region, AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey } = process.env;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const stamp = `${now.toISOString().slice(0, 13).replace(/[-:]/g, '')}0000Z`;
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(READ_TTL_SECONDS),
    'X-Amz-SignedHeaders': 'host',
  });
  query.sort();
  const canonicalQuery = query.toString().replaceAll('+', '%20');
  const canonicalRequest = ['GET', `/${key}`, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signingKey = [day, region, 's3', 'aws4_request'].reduce(hmac, `AWS4${secretKey}`);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}/${key}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};

const newKey = (kind, contentType) => `${KEY_PREFIXES[kind]}/${randomUUID()}.${EXTENSIONS[contentType]}`;

// Returns a presigned PUT url for a new image key. The server never sees the file bytes.
// Under NODE_ENV=test nothing is signed and AWS is never contacted.
const createUploadUrl = async ({ contentType, size, kind }) => {
  const key = newKey(kind, contentType);
  const uploadUrl = IS_TEST
    ? `https://s3.test/${key}?signed=1`
    : await getSignedUrl(
        s3(),
        new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType, ContentLength: size }),
        { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
      );
  return { uploadUrl, key, publicUrl: signedReadUrl(key) };
};

// Uploads bytes from the server itself (import scripts). Returns the new key.
const putImage = async ({ body, contentType, kind }) => {
  const key = newKey(kind, contentType);
  if (!IS_TEST) await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType, Body: body }));
  return key;
};

export { EXTENSIONS, MAX_UPLOAD_BYTES, UPLOAD_KINDS, KEY_PATTERN, signedReadUrl, createUploadUrl, putImage };
