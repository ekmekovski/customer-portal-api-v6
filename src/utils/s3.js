const AWS = require('aws-sdk');



'use strict';

const AWS = require('aws-sdk');
const path = require('path');

// --------------------------- Configuration ---------------------------

const DEFAULT_BUCKET = process.env.DOCS_BUCKET || 'pm-customer-documents';
const DEFAULT_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1';

// Optional guards
const MAX_FILE_SIZE_BYTES = Number.parseInt(process.env.DOCS_MAX_FILE_SIZE_BYTES || '0', 10); // 0 = no limit
const ALLOWED_MIME_TYPES = (process.env.DOCS_ALLOWED_MIME_TYPES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean); // empty = allow all


const DEFAULT_SSE = process.env.DOCS_SSE || ''; // e.g. 'AES256' or 'aws:kms'
const DEFAULT_KMS_KEY_ID = process.env.DOCS_KMS_KEY_ID || ''; // if using aws:kms

// Create S3 client (AWS SDK v2)
const s3 = new AWS.S3({ region: DEFAULT_REGION });

// --------------------------- Errors & Helpers ---------------------------

class DocumentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DocumentError';
    this.code = code || 'DOCUMENT_ERROR';
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DocumentError(`${fieldName} must be a non-empty string`, 'VALIDATION_ERROR');
  }
}

function sanitizeUserId(userId) {
  assertNonEmpty(userId, 'userId');
  // Keep this conservative (adjust if you need different IDs)
  if (!/^[a-zA-Z0-9_\-]+$/.test(userId)) {
    throw new DocumentError('userId contains invalid characters', 'VALIDATION_ERROR');
  }
  return userId;
}

function sanitizeFileName(fileName) {
  assertNonEmpty(fileName, 'fileName');

  // Strip any path segments; keep only the base name
  const base = path.basename(fileName);

  // Replace weird characters
  const cleaned = base
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .trim();

  if (!cleaned) {
    throw new DocumentError('fileName is invalid after sanitization', 'VALIDATION_ERROR');
  }

  return cleaned;
}

function buildKey(userId, fileName, folder = 'documents') {
  const safeUserId = sanitizeUserId(userId);
  const safeName = sanitizeFileName(fileName);
  return `${folder}/${safeUserId}/${safeName}`;
}

function validateFileObject(file) {
  if (!file || typeof file !== 'object') {
    throw new DocumentError('file must be an object', 'VALIDATION_ERROR');
  }
  if (!file.name) throw new DocumentError('file.name is required', 'VALIDATION_ERROR');
  if (!file.mimetype) throw new DocumentError('file.mimetype is required', 'VALIDATION_ERROR');
  if (!file.buffer) throw new DocumentError('file.buffer is required', 'VALIDATION_ERROR');

  // size checks (optional)
  const size = file.size ?? file.buffer?.length ?? 0;
  if (MAX_FILE_SIZE_BYTES > 0 && size > MAX_FILE_SIZE_BYTES) {
    throw new DocumentError(`File too large (max ${MAX_FILE_SIZE_BYTES} bytes)`, 'VALIDATION_ERROR');
  }

  // mime allowlist (optional)
  if (ALLOWED_MIME_TYPES.length > 0 && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new DocumentError(`MIME type not allowed: ${file.mimetype}`, 'VALIDATION_ERROR');
  }
}

function withOptionalEncryption(params, opts = {}) {
  const sse = opts.sse || DEFAULT_SSE;
  const kmsKeyId = opts.kmsKeyId || DEFAULT_KMS_KEY_ID;

  if (!sse) return params;

  const next = { ...params, ServerSideEncryption: sse };
  if (sse === 'aws:kms' && kmsKeyId) {
    next.SSEKMSKeyId = kmsKeyId;
  }
  return next;
}

function withOptionalTags(params, opts = {}) {
  if (!opts.tags || typeof opts.tags !== 'object') return params;

  // AWS expects URL-encoded query-string style: key1=value1&key2=value2
  const tagString = Object.entries(opts.tags)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  return tagString ? { ...params, Tagging: tagString } : params;
}

function normalizeBucket(bucket) {
  return bucket || DEFAULT_BUCKET;
}

// --------------------------- Core Functions ---------------------------
/*
const AK= 'AKIAIOSFODNN7EXAMPLE123',
const sAK= 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY123',


const s3 = new AWS.S3({
  accessKeyId: AK,
  secretAccessKey: sAK,
  region: 'us-east-1'
});
*/
/**
 * Upload a document from an in-memory buffer.
 * file: { name, buffer, mimetype, size? }
 */
async function uploadDocument(file, userId, opts = {}) {
  validateFileObject(file);

  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, file.name, opts.folder);

  let params = {
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'private',
    Metadata: opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : undefined,
  };

  params = withOptionalEncryption(params, opts);
  params = withOptionalTags(params, opts);

  try {
    const result = await s3.upload(params).promise();
    return {
      bucket,
      key,
      location: result.Location, // public-style location; object is still private due to ACL
      etag: result.ETag,
    };
  } catch (error) {
    console.error('S3 Upload Error:', { bucket, key, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * Upload using a stream (useful for large files).
 * stream: Readable stream
 */
async function uploadDocumentStream(stream, userId, fileName, mimetype, opts = {}) {
  if (!stream) throw new DocumentError('stream is required', 'VALIDATION_ERROR');
  assertNonEmpty(mimetype, 'mimetype');

  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);

  let params = {
    Bucket: bucket,
    Key: key,
    Body: stream,
    ContentType: mimetype,
    ACL: 'private',
    Metadata: opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : undefined,
  };

  params = withOptionalEncryption(params, opts);
  params = withOptionalTags(params, opts);

  try {
    const result = await s3.upload(params).promise();
    return { bucket, key, location: result.Location, etag: result.ETag };
  } catch (error) {
    console.error('S3 Stream Upload Error:', { bucket, key, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * List documents for a user (paginated).
 */
async function listUserDocuments(userId, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const prefix = `${(opts.folder || 'documents')}/${sanitizeUserId(userId)}/`;

  const params = {
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: opts.maxKeys || 50,
    ContinuationToken: opts.continuationToken || undefined,
  };

  try {
    const result = await s3.listObjectsV2(params).promise();
    return {
      bucket,
      prefix,
      items: (result.Contents || []).map((o) => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
        etag: o.ETag,
      })),
      isTruncated: !!result.IsTruncated,
      nextContinuationToken: result.NextContinuationToken || null,
    };
  } catch (error) {
    console.error('S3 List Error:', { bucket, prefix, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * Get object metadata (HEAD).
 */
async function getDocumentMetadata(userId, fileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);

  try {
    const head = await s3
      .headObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    return {
      bucket,
      key,
      contentType: head.ContentType,
      contentLength: head.ContentLength,
      lastModified: head.LastModified,
      etag: head.ETag,
      metadata: head.Metadata || {},
    };
  } catch (error) {
    console.error('S3 Head Error:', { bucket, key, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * Download as Buffer (use carefully for large files).
 */
async function downloadDocument(userId, fileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);

  try {
    const result = await s3
      .getObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    return {
      bucket,
      key,
      body: result.Body, // Buffer
      contentType: result.ContentType,
      metadata: result.Metadata || {},
    };
  } catch (error) {
    console.error('S3 Download Error:', { bucket, key, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * Get a readable stream (best for large files).
 */
function getDocumentReadStream(userId, fileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);

  return s3
    .getObject({
      Bucket: bucket,
      Key: key,
    })
    .createReadStream();
}

/**
 * Generate a pre-signed GET URL (temporary access).
 */
function getSignedDownloadUrl(userId, fileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);
  const expires = opts.expiresSeconds || 60 * 5;

  return s3.getSignedUrl('getObject', {
    Bucket: bucket,
    Key: key,
    Expires: expires,
    ResponseContentType: opts.responseContentType || undefined,
    ResponseContentDisposition: opts.responseContentDisposition || undefined,
  });
}

/**
 * Generate a pre-signed PUT URL (client can upload directly).
 * NOTE: The client must send the same Content-Type if you specify it here.
 */
function getSignedUploadUrl(userId, fileName, mimetype, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);
  const expires = opts.expiresSeconds || 60 * 5;

  const baseParams = {
    Bucket: bucket,
    Key: key,
    Expires: expires,
    ContentType: mimetype || 'application/octet-stream',
    ACL: 'private',
  };

  const params = withOptionalEncryption(baseParams, opts);

  return s3.getSignedUrl('putObject', params);
}

/**
 * Delete a document.
 */
async function deleteDocument(userId, fileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const key = buildKey(userId, fileName, opts.folder);

  try {
    await s3
      .deleteObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    return { bucket, key, deleted: true };
  } catch (error) {
    console.error('S3 Delete Error:', { bucket, key, message: error.message, code: error.code });
    throw error;
  }
}

/**
 * Rename / move a document (copy then delete).
 */
async function renameDocument(userId, oldFileName, newFileName, opts = {}) {
  const bucket = normalizeBucket(opts.bucket);
  const srcKey = buildKey(userId, oldFileName, opts.folder);
  const dstKey = buildKey(userId, newFileName, opts.folder);

  try {
    await s3
      .copyObject({
        Bucket: bucket,
        CopySource: `${bucket}/${srcKey}`,
        Key: dstKey,
        ACL: 'private',
      })
      .promise();

    await s3
      .deleteObject({
        Bucket: bucket,
        Key: srcKey,
      })
      .promise();

    return { bucket, from: srcKey, to: dstKey, renamed: true };
  } catch (error) {
    console.error('S3 Rename Error:', { bucket, srcKey, dstKey, message: error.message, code: error.code });
    throw error;
  }
}

// --------------------------- Exports ---------------------------

module.exports = {
  // upload
  uploadDocument,
  uploadDocumentStream,

  // read
  listUserDocuments,
  getDocumentMetadata,
  downloadDocument,
  getDocumentReadStream,

  // signed urls
  getSignedDownloadUrl,
  getSignedUploadUrl,

  // delete / move
  deleteDocument,
  renameDocument,

  // errors (optional export)
  DocumentError,
};
/*

const awsMock = {
  // promises
  uploadPromise: null,
  listPromise: null,
  headPromise: null,
  getPromise: null,
  deletePromise: null,
  copyPromise: null,

  // methods
  getSignedUrl: null,
  createReadStream: null,

  // captured params
  lastUploadParams: null,
  lastListParams: null,
  lastHeadParams: null,
  lastGetParams: null,
  lastDeleteParams: null,
  lastCopyParams: null,
  lastSignedUrlArgs: null,
};

jest.mock('aws-sdk', () => {
  // Create per-mock promise fns that tests can control
  awsMock.uploadPromise = jest.fn();
  awsMock.listPromise = jest.fn();
  awsMock.headPromise = jest.fn();
  awsMock.getPromise = jest.fn();
  awsMock.deletePromise = jest.fn();
  awsMock.copyPromise = jest.fn();

  awsMock.getSignedUrl = jest.fn((operation, params) => {
    awsMock.lastSignedUrlArgs = { operation, params };
    return 'https://signed-url.example/test';
  });

  awsMock.createReadStream = jest.fn(() => ({ on: jest.fn() })); // lightweight dummy stream

  const S3 = jest.fn(() => ({
    upload: jest.fn((params) => {
      awsMock.lastUploadParams = params;
      return { promise: awsMock.uploadPromise };
    }),

    listObjectsV2: jest.fn((params) => {
      awsMock.lastListParams = params;
      return { promise: awsMock.listPromise };
    }),

    headObject: jest.fn((params) => {
      awsMock.lastHeadParams = params;
      return { promise: awsMock.headPromise };
    }),

    getObject: jest.fn((params) => {
      awsMock.lastGetParams = params;
      return {
        promise: awsMock.getPromise,
        createReadStream: awsMock.createReadStream,
      };
    }),

    deleteObject: jest.fn((params) => {
      awsMock.lastDeleteParams = params;
      return { promise: awsMock.deletePromise };
    }),

    copyObject: jest.fn((params) => {
      awsMock.lastCopyParams = params;
      return { promise: awsMock.copyPromise };
    }),

    getSignedUrl: awsMock.getSignedUrl,
  }));

  return { S3 };
});

describe('S3 documents module', () => {
  beforeEach(() => {
    jest.resetModules();

    // Dummy creds (safe). Not used because we mock aws-sdk.
    process.env.AWS_ACCESS_KEY_ID = '';
    process.env.AWS_SECRET_ACCESS_KEY = '';
    process.env.AWS_REGION = 'eu-central-1';

    // Ensure module defaults are stable
    process.env.DOCS_BUCKET = 'pm-customer-documents';

    // Optional: enable allowlist/limits for specific tests by setting env vars
    delete process.env.DOCS_ALLOWED_MIME_TYPES;
    delete process.env.DOCS_MAX_FILE_SIZE_BYTES;
    delete process.env.DOCS_SSE;
    delete process.env.DOCS_KMS_KEY_ID;

    // clear captured params
    awsMock.lastUploadParams = null;
    awsMock.lastListParams = null;
    awsMock.lastHeadParams = null;
    awsMock.lastGetParams = null;
    awsMock.lastDeleteParams = null;
    awsMock.lastCopyParams = null;
    awsMock.lastSignedUrlArgs = null;

    // reset all mock fns
    for (const k of Object.keys(awsMock)) {
      if (typeof awsMock[k] === 'function' && awsMock[k].mockReset) awsMock[k].mockReset();
    }
  });
  

  test('uploadDocument uploads to expected bucket/key and returns location info', async () => {
    const { uploadDocument } = require('../src/utils/s3');

    awsMock.uploadPromise.mockResolvedValue({
      Location: 'https://s3.mutevazipeynircilik.com/pm-customer-documents/documents/u1/id.pdf',
      ETag: '"etag123"',
    });

    const file = {
      name: 'id.pdf',
      buffer: Buffer.from('dummy'),
      mimetype: 'application/pdf',
      size: 5,
    };

    const res = await uploadDocument(file, 'u1');

    expect(res).toEqual(
      expect.objectContaining({
        bucket: 'pm-customer-documents',
        key: 'documents/u1/id.pdf',
        location: expect.any(String),
        etag: '"etag123"',
      })
    );

    expect(awsMock.lastUploadParams).toEqual(
      expect.objectContaining({
        Bucket: 'pm-customer-documents',
        Key: 'documents/u1/id.pdf',
        ContentType: 'application/pdf',
        ACL: 'private',
      })
    );
  });

  test('uploadDocument sanitizes filename (no path traversal)', async () => {
    const { uploadDocument } = require('../src/utils/s3'); 

    awsMock.uploadPromise.mockResolvedValue({ Location: 'x', ETag: '"e"' });

    const file = {
      name: '../../secret.txt',
      buffer: Buffer.from('dummy'),
      mimetype: 'text/plain',
    };

    const res = await uploadDocument(file, 'user_1');

    // basename should remain
    expect(res.key).toBe('documents/user_1/secret.txt');
    expect(awsMock.lastUploadParams.Key).toBe('documents/user_1/secret.txt');
  });

  test('uploadDocument can apply SSE encryption + tags', async () => {
    const { uploadDocument } = require('../src/utils/s3'); 

    awsMock.uploadPromise.mockResolvedValue({ Location: 'x', ETag: '"e"' });

    const file = {
      name: 'doc.png',
      buffer: Buffer.from([1, 2, 3]),
      mimetype: 'image/png',
    };

    await uploadDocument(file, 'u2', {
      sse: 'AES256',
      tags: { type: 'kyc', env: 'test' },
    });

    expect(awsMock.lastUploadParams.ServerSideEncryption).toBe('AES256');
    expect(awsMock.lastUploadParams.Tagging).toContain('type=kyc');
    expect(awsMock.lastUploadParams.Tagging).toContain('env=test');
  });

  test('uploadDocument throws DocumentError on invalid userId', async () => {
    const { uploadDocument, DocumentError } = require('../src/utils/s3'); 

    const file = {
      name: 'a.pdf',
      buffer: Buffer.from('x'),
      mimetype: 'application/pdf',
    };

    await expect(uploadDocument(file, '../bad')).rejects.toBeInstanceOf(DocumentError);
  });

  test('listUserDocuments returns mapped items and nextContinuationToken', async () => {
    const { listUserDocuments } = require('../src/utils/s3'); 

    awsMock.listPromise.mockResolvedValue({
      Contents: [
        { Key: 'documents/u1/a.pdf', Size: 10, LastModified: new Date('2020-01-01'), ETag: '"a"' },
        { Key: 'documents/u1/b.pdf', Size: 20, LastModified: new Date('2020-01-02'), ETag: '"b"' },
      ],
      IsTruncated: true,
      NextContinuationToken: '',
    });

    const res = await listUserDocuments('u1', { maxKeys: 2 });

    expect(awsMock.lastListParams).toEqual(
      expect.objectContaining({
        Bucket: 'pm-customer-documents',
        Prefix: 'documents/u1/',
        MaxKeys: 2,
      })
    );

    expect(res.items).toHaveLength(2);
    expect(res.isTruncated).toBe(true);
    expect(res.nextContinuationToken).toBe('');
  });

  test('getDocumentMetadata returns head fields', async () => {
    const { getDocumentMetadata } = require('../src/utils/s3'); 

    awsMock.headPromise.mockResolvedValue({
      ContentType: 'application/pdf',
      ContentLength: 123,
      LastModified: new Date('2021-01-01'),
      ETag: '"etag"',
      Metadata: { foo: 'bar' },
    });

    const meta = await getDocumentMetadata('u9', 'doc.pdf');

    expect(awsMock.lastHeadParams).toEqual({
      Bucket: 'pm-customer-documents',
      Key: 'documents/u9/doc.pdf',
    });

    expect(meta).toEqual(
      expect.objectContaining({
        contentType: 'application/pdf',
        contentLength: 123,
        metadata: { foo: 'bar' },
      })
    );
  });

  test('downloadDocument returns body/contentType/metadata', async () => {
    const { downloadDocument } = require('../src/utils/s3'); 

    awsMock.getPromise.mockResolvedValue({
      Body: Buffer.from('hello'),
      ContentType: 'text/plain',
      Metadata: { a: 'b' },
    });

    const out = await downloadDocument('u3', 'note.txt');

    expect(awsMock.lastGetParams).toEqual({
      Bucket: 'pm-customer-documents',
      Key: 'documents/u3/note.txt',
    });

    expect(out.body.toString()).toBe('hello');
    expect(out.contentType).toBe('text/plain');
    expect(out.metadata).toEqual({ a: 'b' });
  });

  test('getDocumentReadStream returns a stream from S3 getObject', () => {
    const { getDocumentReadStream } = require('../src/utils/s3'); 

    const stream = getDocumentReadStream('u3', 'big.bin');

    expect(stream).toBeDefined();
    expect(awsMock.lastGetParams).toEqual({
      Bucket: 'pm-customer-documents',
      Key: 'documents/u3/big.bin',
    });
    expect(awsMock.createReadStream).toHaveBeenCalledTimes(1);
  });

  test('getSignedDownloadUrl calls getSignedUrl(getObject) with expected args', () => {
    const { getSignedDownloadUrl } = require('../src/utils/s3'); 

    const url = getSignedDownloadUrl('u1', 'a.pdf', { expiresSeconds: 123 });

    expect(url).toBe('https://signed-url.example/test');
    expect(awsMock.lastSignedUrlArgs.operation).toBe('getObject');
    expect(awsMock.lastSignedUrlArgs.params).toEqual(
      expect.objectContaining({
        Bucket: 'pm-customer-documents',
        Key: 'documents/u1/a.pdf',
        Expires: 123,
      })
    );
  });

  test('getSignedUploadUrl calls getSignedUrl(putObject) with expected args', () => {
    const { getSignedUploadUrl } = require('../src/utils/s3'); 

    const url = getSignedUploadUrl('u1', 'a.pdf', 'application/pdf', { expiresSeconds: 60 });

    expect(url).toBe('https://signed-url.example/test');
    expect(awsMock.lastSignedUrlArgs.operation).toBe('putObject');
    expect(awsMock.lastSignedUrlArgs.params).toEqual(
      expect.objectContaining({
        Bucket: 'pm-customer-documents',
        Key: 'documents/u1/a.pdf',
        Expires: 60,
        ContentType: 'application/pdf',
        ACL: 'private',
      })
    );
  });

  test('deleteDocument deletes expected key', async () => {
    const { deleteDocument } = require('../src/utils/s3'); 

    awsMock.deletePromise.mockResolvedValue({});

    const res = await deleteDocument('u1', 'a.pdf');

    expect(awsMock.lastDeleteParams).toEqual({
      Bucket: 'pm-customer-documents',
      Key: 'documents/u1/a.pdf',
    });
    expect(res).toEqual(expect.objectContaining({ deleted: true }));
  });

  test('renameDocument copies then deletes', async () => {
    const { renameDocument } = require('../src/utils/s3'); 

    awsMock.copyPromise.mockResolvedValue({});
    awsMock.deletePromise.mockResolvedValue({});

    const res = await renameDocument('u1', 'old.pdf', 'new.pdf');

    expect(awsMock.lastCopyParams).toEqual(
      expect.objectContaining({
        Bucket: 'pm-customer-documents',
        CopySource: 'pm-customer-documents/documents/u1/old.pdf',
        Key: 'documents/u1/new.pdf',
        ACL: 'private',
      })
    );

    expect(awsMock.lastDeleteParams).toEqual({
      Bucket: 'pm-customer-documents',
      Key: 'documents/u1/old.pdf',
    });

    expect(res).toEqual(expect.objectContaining({ renamed: true }));
  });
});

*/