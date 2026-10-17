import { createAdoptionServer } from './server.mjs';
import { SessionAuthority } from './session-authority.mjs';
import { readFile } from 'node:fs/promises';
import { openRepository } from './repository.mjs';
import { createProposalStore } from './proposals.mjs';

const port = 4193;
const origin = `http://127.0.0.1:${port}`;
const authority = new SessionAuthority({ development: true });
const registration = authority.registerApproved({ embeddingId:'local-fixture', origins:[origin], expiresAt:Date.now()+3_600_000 });
const template = await readFile(new URL('../test/fixture.html',import.meta.url),'utf8');
const fixture = template.replace('__INSTALLATION_TOKEN__',registration.installationToken);
const repository=openRepository();
const proposals=createProposalStore(repository);
// Deterministic fixture, not a production model. Exercises the exact same
// server validation, review and browser action path without external data transfer.
const planner=async({text,snapshot})=>{
  const match=/^set (.+) to (.+)$/i.exec(text.trim());
  const field=match&&snapshot.fields.find(f=>f.label.toLowerCase()===match[1].toLowerCase());
  return {message:'Deterministic test planner (not an LLM): review the proposed field.',actions:field?[{type:'fill',ref:field.ref,value:match[2]}]:[]};
};
const server = createAdoptionServer({ authority, proposals, planner, development:true, fixture });
server.listen(port,'127.0.0.1',() => console.log(`Local synthetic fixture: ${origin}/fixture`));
process.on('SIGINT',() => { server.closeAllConnections(); server.close(()=>repository.close()); });
