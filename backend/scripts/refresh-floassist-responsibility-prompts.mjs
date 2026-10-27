import {readFileSync} from 'node:fs';
import {getDb} from '../src/db/schema.js';
import {responsibilityPrompt} from '../src/services/floassist/responsibilities.js';
import {updateScheduledGoal} from '../src/services/scheduled-goals.js';
const owner=process.argv[2];if(!owner)throw new Error('Explicit owner ID required');
const db=getDb(),profile=db.prepare('SELECT preferences_json,agent_id FROM floassist_profiles WHERE owner_id=?').get(owner);if(!profile)throw new Error('FloAssist profile not found');
const product=JSON.parse(readFileSync(new URL('../src/services/floassist/product.json',import.meta.url),'utf8')),preferences=JSON.parse(profile.preferences_json);let updated=0;
for(const responsibility of product.responsibilities){const rows=db.prepare('SELECT id,prompt,status,execution_mode,plan_json FROM scheduled_goals WHERE owner_user_id=? AND agent_id=? AND source=?').all(owner,profile.agent_id,'floassist:'+responsibility.id);for(const row of rows){const prompt=responsibilityPrompt(product,preferences,responsibility);if(prompt===row.prompt)continue;updateScheduledGoal(owner,row.id,{prompt});const after=db.prepare('SELECT status,execution_mode,plan_json FROM scheduled_goals WHERE id=? AND owner_user_id=?').get(row.id,owner);if(after.status!==row.status||after.execution_mode!==row.execution_mode||after.plan_json!==row.plan_json)throw new Error('Schedule state unexpectedly changed');updated++;}}
console.log(JSON.stringify({promptsUpdated:updated,statusAndPlansPreserved:true}));process.exit(0);
