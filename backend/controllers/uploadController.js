import express from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { httpError } from '../utils/validation.js';

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const productUploadsDirectory = fileURLToPath(new URL('../uploads/products/', import.meta.url));
const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const isPng = (bytes) => {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) return false;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) return false;
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) return false;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT' && length > 0) hasImageData = true;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && hasImageData && offset === bytes.length;
  }
  return false;
};

const isJpeg = (bytes) => {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  let hasScanData = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      if (!hasScan) return false;
      hasScanData = true;
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!hasScan) return false;
      hasScanData = true;
      continue;
    }
    if (marker === 0xd9) return hasFrame && hasScan && hasScanData && offset === bytes.length;
    if (marker === 0xd8 || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    // Start-of-frame markers carry the image dimensions and component count.
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 11 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false;
      const components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!hasFrame || length < 8 || length !== 6 + bytes[offset + 2] * 2) return false;
      hasScan = true;
    }
    offset += length;
  }
  return false;
};

const isWebp = (bytes) => {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  let hasImageData = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (length > bytes.length - start || start + length + (length % 2) > bytes.length) return false;
    if (type === 'VP8 ') {
      if (length < 11 || (bytes[start] & 1) !== 0 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a])) || !(bytes.readUInt16LE(start + 6) & 0x3fff) || !(bytes.readUInt16LE(start + 8) & 0x3fff)) return false;
      hasImageData = true;
    } else if (type === 'VP8L') {
      if (length < 6 || bytes[start] !== 0x2f || (bytes.readUInt32LE(start + 1) >>> 29) !== 0) return false;
      hasImageData = true;
    } else if (type === 'VP8X' && (length !== 10 || (bytes[start] & 0xc1) !== 0)) return false;
    // Animated images contain independent encoded frames in ANMF chunks.
    else if (type === 'ANMF') return false;
    offset = start + length + (length % 2);
  }
  return hasImageData && offset === bytes.length;
};

const validators = new Map([['image/jpeg', isJpeg], ['image/png', isPng], ['image/webp', isWebp]]);
const contentTypeOf = (req) => (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
const rawParser = express.raw({ type: () => true, limit: MAX_PRODUCT_IMAGE_BYTES, inflate: false });

// Apply only after authentication/administrator checks so unauthorized requests
// never buffer uploaded files in memory.
export const parseProductImage = (req, res, next) => {
  if (!imageTypes.has(contentTypeOf(req))) return next(httpError(415, 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP'));
  rawParser(req, res, (error) => {
    if (error?.type === 'entity.too.large') return next(httpError(413, 'Ảnh không được lớn hơn 5 MB'));
    if (error?.type === 'encoding.unsupported') return next(httpError(415, 'Vui lòng tải lên tệp ảnh gốc, không nén nội dung yêu cầu'));
    next(error);
  });
};

export const createProductUploadHandler = ({ directory = productUploadsDirectory } = {}) => async (req, res) => {
  const type = contentTypeOf(req);
  if (!imageTypes.has(type)) throw httpError(415, 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'Vui lòng chọn ảnh để tải lên');
  if (req.body.length > MAX_PRODUCT_IMAGE_BYTES) throw httpError(413, 'Ảnh không được lớn hơn 5 MB');
  if (!validators.get(type)(req.body)) throw httpError(400, 'Tệp ảnh không hợp lệ, bị thiếu dữ liệu hoặc không khớp định dạng');
  const filename = `${randomUUID()}.${imageTypes.get(type)}`;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), req.body, { flag: 'wx' });
  res.status(201).json({ image: `/uploads/products/${filename}` });
};

export const serveProductImages = ({ directory = productUploadsDirectory } = {}) => {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(express.static(directory, { dotfiles: 'deny', fallthrough: false, index: false, redirect: false, maxAge: '1y', immutable: true }));
  return router;
};
