import { initDb } from '../src/db/schema.js';
import {
  createUserApiKey,
  resolveUserApiKey,
  resolveHeadersObject,
  listUserApiKeys,
  PLATFORM_BYOK_KEY_NAME,
  deleteUserApiKey,
  findApiKeyDependencies,
} from '../src/services/user-api-keys.js';

process.env.USER_API_KEYS_KEK = `test-kek-${Date.now()}`;
initDb();
const owner = `ceo-vault-${Date.now()}`;
createUserApiKey(owner, { keyName: 'plain-key', apiKey: 'sk-plain-1234' });
createUserApiKey(owner, { keyName: 'enc-key', apiKey: 'sk-secret-9999', encryptionPhrase: 'my-phrase' });
createUserApiKey(owner, { keyName: PLATFORM_BYOK_KEY_NAME, apiKey: 'sk-byok-abc' });
if (resolveUserApiKey(owner, 'plain-key').value !== 'sk-plain-1234') throw new Error('plain fail');
if (resolveUserApiKey(owner, 'enc-key').value !== 'sk-secret-9999') throw new Error('enc fail');
const hdrs = resolveHeadersObject(owner, { A: 'x', B: { $keyRef: 'plain-key' } });
if (hdrs.B !== 'sk-plain-1234') throw new Error('hdr fail ' + JSON.stringify(hdrs));
const keys = listUserApiKeys(owner);
console.log('VAULT_UNIT_OK', keys.map((k) => ({ n: k.key_name, enc: k.is_encrypted, hint: k.key_hint })));
