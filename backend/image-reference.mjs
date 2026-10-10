import { HttpError } from './auth.mjs';

export const IMAGE_KEY_ROOT = 'asset-photos';
export const MAX_IMAGE_BYTES = 3_500_000;

function subjectPrefix(subject) {
  if (typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subject)) {
    throw new HttpError(403, 'Image owner is invalid');
  }
  return `${IMAGE_KEY_ROOT}/${subject}/`;
}

export function validateOwnedImageKey(imageKey, subject) {
  if (typeof imageKey !== 'string' || imageKey.length > 512 ||
      imageKey.includes('\\') || imageKey.includes('\0') || imageKey.split('/').includes('..')) {
    throw new HttpError(400, 'Image key is invalid');
  }
  if (!imageKey.startsWith(subjectPrefix(subject))) {
    throw new HttpError(403, 'Image access is not allowed');
  }
  const filename = imageKey.slice(subjectPrefix(subject).length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(jpe?g|png)$/i.test(filename) || filename.includes('..')) {
    throw new HttpError(400, 'Image key must identify a JPEG or PNG draft');
  }
  return imageKey;
}

export function detectImageFormat(bytes, declaredContentType) {
  const contentType = String(declaredContentType ?? '').split(';', 1)[0].trim().toLowerCase();
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (jpeg && (contentType === '' || contentType === 'image/jpeg')) return { format: 'jpeg', contentType: 'image/jpeg' };
  if (png && (contentType === '' || contentType === 'image/png')) return { format: 'png', contentType: 'image/png' };
  throw new HttpError(400, 'Stored object is not a supported JPEG or PNG image');
}

export async function bodyToBytes(body, maxBytes = MAX_IMAGE_BYTES) {
  let bytes;
  if (body instanceof Uint8Array) {
    bytes = body;
  } else if (body && typeof body.transformToByteArray === 'function') {
    bytes = await body.transformToByteArray();
  } else if (body && body[Symbol.asyncIterator]) {
    const chunks = [];
    let length = 0;
    for await (const chunk of body) {
      const part = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      length += part.length;
      if (length > maxBytes) throw new HttpError(413, 'Image exceeds the maximum allowed size');
      chunks.push(part);
    }
    bytes = Buffer.concat(chunks);
  } else {
    throw new HttpError(502, 'Stored image body could not be read');
  }
  if (bytes.length === 0) throw new HttpError(400, 'Stored image is empty');
  if (bytes.length > maxBytes) throw new HttpError(413, 'Image exceeds the maximum allowed size');
  return Uint8Array.from(bytes);
}
