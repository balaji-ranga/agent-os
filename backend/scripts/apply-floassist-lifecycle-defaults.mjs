// Explicit owner only. Does not activate schedules or alter quiet hours/policies.
import {getDb} from '../src/db/schema.js';
import {ALERT_DEFAULTS,validateAlertPreferences} from '../src/services/floassist/alert-policy.js';
import {readFileSync} from 'node:fs';
const owner=process.argv[2];if(!owner)throw Error('An explicit owner ID is required');
const db=getDb(),row=db.prepare('SELECT preferences_json FROM floassist_profiles WHERE owner_id=?').get(owner);
if(!row)throw Error('FloAssist profile not found');
const before=JSON.parse(row.preferences_json),after={...ALERT_DEFAULTS,...before};
const product=JSON.parse(readFileSync(new URL('../src/services/floassist/product.json',import.meta.url)));
validateAlertPreferences(after,product.connectors.map(c=>c.id));
db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify(after),owner);
console.log(JSON.stringify({updatedKeys:Object.keys(after).filter(k=>before[k]===undefined),schedulesUntouched:true,quietHoursPreserved:after.quiet_start===before.quiet_start&&after.quiet_end===before.quiet_end}));
process.exit(0);
