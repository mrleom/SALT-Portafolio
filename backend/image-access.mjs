import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { HttpError } from './auth.mjs';
import { IMAGE_KEY_ROOT, validateOwnedImageKey } from './image-reference.mjs';

const ALLOWED_CONTENT_TYPES = Object.freeze(['image/jpeg', 'image/png']);

export function buildUploadKey(subject, filename) {
  // Validate filename: alphanumeric, dots, dashes, underscores; must end in .jpg/.jpeg/.png
  if (typeof filename !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(jpe?g|png)$/i.test(filename) ||
      filename.includes('..')) {
    throw new HttpError(400, 'filename must be a JPEG or PNG name with no path separators');
  }
  if (typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subject)) {
    throw new HttpError(403, 'Image owner is invalid');
  }
  return `${IMAGE_KEY_ROOT}/${subject}/${filename}`;
}

export function createImageAccessService({
  s3Client,
  presign,
  bucketName,
  expiresIn = 60,
}) {
  function validateBucket() {
    if (typeof bucketName !== 'string' || !bucketName.trim()) {
      throw new HttpError(503, 'Asset photo bucket is not configured');
    }
    if (!Number.isInteger(expiresIn) || expiresIn < 15 || expiresIn > 300) {
      throw new TypeError('expiresIn must be from 15 through 300 seconds');
    }
    return bucketName.trim();
  }

  return Object.freeze({
    async createStoredReadUrl(imageKey) {
      const bucket = validateBucket();
      if (typeof imageKey !== 'string' || !/^asset-photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(jpe?g|png)$/i.test(imageKey) || imageKey.includes('..')) throw new HttpError(400, 'Invalid stored image reference');
      const url = await presign(s3Client, new GetObjectCommand({ Bucket: bucket, Key: imageKey }), { expiresIn });
      return { imageKey, url, expiresIn };
    },
    async createReadUrl({ imageKey, subject }) {
      const bucket = validateBucket();
      const Key = validateOwnedImageKey(imageKey, subject);
      let url;
      try {
        url = await presign(
          s3Client,
          new GetObjectCommand({ Bucket: bucket, Key }),
          { expiresIn },
        );
      } catch {
        throw new HttpError(502, 'Secure image access could not be created');
      }
      return Object.freeze({ imageKey: Key, url, expiresIn });
    },

    async createUploadUrl({ subject, filename, contentType }) {
      const bucket = validateBucket();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new HttpError(400, 'contentType must be image/jpeg or image/png');
      }
      const Key = buildUploadKey(subject, filename);
      let url;
      try {
        // Bind the declared type to the upload. The browser sends this same header.
        // Image analysis separately checks file signatures and size.
        url = await presign(
          s3Client,
          new PutObjectCommand({ Bucket: bucket, Key, ContentType: contentType }),
          { expiresIn },
        );
      } catch {
        throw new HttpError(502, 'Secure upload URL could not be created');
      }
      return Object.freeze({ imageKey: Key, url, expiresIn });
    },
  });
}
