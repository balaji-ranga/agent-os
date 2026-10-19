// Refresh shipped public platform help only. No visitor/owner knowledge changes.
import {initDb} from '../src/db/schema.js';
import {ensurePlatformHelpInOpenSearch} from '../src/services/opensearch/platform-docs.js';
initDb();
const result=await ensurePlatformHelpInOpenSearch();
console.log(JSON.stringify({status:'published',scope:'platform help only',created:result.created,updated:result.updated,skipped:result.skipped}));
