// ─────────────────────────────────────────────────────────────
// 8 Second Rides — Azure Blob Storage helper (vehicle photos)
// Env: AZURE_STORAGE_CONNECTION_STRING
// Container "vehicle-photos" is created (public-read, blob-level) on
// first use if it doesn't exist yet — no manual portal setup needed
// beyond creating the storage account itself.
// ──────────────────────────────────────────────────────────
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'vehicle-photos';
let _container = null;

function configured() {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

async function getContainer() {
  if (_container) return _container;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  const service = BlobServiceClient.fromConnectionString(conn);
  const container = service.getContainerClient(CONTAINER);
  await container.createIfNotExists({ access: 'blob' }); // public read on blobs, not container listing
  _container = container;
  return container;
}

// Uploads a base64 data URL (e.g. "data:image/png;base64,....") and
// returns the public blob URL. `prefix` namespaces the blob name
// (e.g. "class" or "vehicle") so photos for different entities don't collide.
async function uploadDataUrl(prefix, id, dataUrl) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Expected a base64 image data URL');
  const [, mime, b64] = match;
  const ext = mime.split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Image too large (8MB max)');

  const container = await getContainer();
  const blobName = `${prefix}/${id}-${Date.now()}.${ext}`;
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mime } });
  return blockBlob.url;
}

module.exports = { configured, uploadDataUrl };
