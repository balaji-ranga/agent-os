import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {requireAppCoverage,pendingSourceCoverage,continuableSourceCoverage,withSourceProviderAttempt} from '../src/services/floassist/source-coverage.js';
const db=new DatabaseSync(':memory:');
for(const status of [401,403,408,429,500,502,503,504]){
 const scope={owner:'one',run:'failure-'+status};let calls=0;
 requireAppCoverage(db,scope,'provider',{app_id:'provider'});
 const attempt=()=>withSourceProviderAttempt(db,scope,'provider',async()=>{calls++;throw Object.assign(Error('fixture'),{status});});
 const result=await Promise.allSettled([attempt(),attempt(),attempt()]);
 assert(result.every(r=>r.status==='rejected'));assert.equal(calls,1);
 assert.equal(continuableSourceCoverage(pendingSourceCoverage(db,scope.owner,scope.run)).length,0);
 assert.equal(pendingSourceCoverage(db,scope.owner,scope.run).length,1,'failure never claims complete coverage');
 assert.equal(await withSourceProviderAttempt(db,{...scope,owner:'two'},'provider',async()=>42),42);
 assert.equal(await withSourceProviderAttempt(db,{...scope,run:'new-'+status},'provider',async()=>42),42);
 assert.equal(await withSourceProviderAttempt(db,scope,'other-provider',async()=>42),42);
}
for(const status of [400,404,409,422]){
 const scope={owner:'one',run:'correctable-'+status};
 await assert.rejects(withSourceProviderAttempt(db,scope,'provider',async()=>{throw Object.assign(Error('input'),{status});}));
 assert.equal(await withSourceProviderAttempt(db,scope,'provider',async()=>42),42);
}
db.close();console.log('PROVIDER_FAILURE_BOUND_OK: eight failure classes; concurrent retries blocked; owner/run/provider isolation; schema corrections allowed');
