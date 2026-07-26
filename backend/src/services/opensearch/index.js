/**
 * OpenSearch document RAG public API.
 */
export {
  getOpenSearchConfig,
  isOpenSearchConfigured,
  opensearchRequest,
  opensearchBulk,
  opensearchPing,
  waitForOpenSearch,
} from './client.js';

export {
  PLATFORM_OWNER_ID,
  ownerFingerprint,
  isPlatformOwner,
  indexOwnerKey,
  metaIndexName,
  searchIndexName,
  embeddingDims,
  ensureOwnerIndices,
  ensurePlatformIndices,
  deleteOwnerIndices,
} from './indices.js';

export { embedTexts } from './embeddings.js';

export {
  chunkText,
  mapMetaHit,
  indexDocument,
  updateDocumentTags,
  listDocuments,
  getDocument,
  deleteDocumentIndex,
  searchDocuments,
} from './documents.js';

export {
  openSearchConsoleProxy,
  createOsConsoleLaunchUrl,
  createOsConsoleLaunchCookie,
  clearOsConsoleCookieHeader,
  clearOsConsoleCookieHeaders,
  adminFromOsConsoleCookie,
  getOsConsolePublicUrl,
  parseCookieHeader,
  isRequestSecure,
} from './console-proxy.js';

export { ensurePlatformHelpInOpenSearch } from './platform-docs.js';
