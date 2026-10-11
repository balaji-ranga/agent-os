import assert from 'node:assert/strict';
import {setMemorySchedule} from './set-openclaw-memory-schedule.mjs';
const before={
  agents:{list:[{id:'tenant-agent',workspace:'/preserved'}]},
  gateway:{auth:{token:'fixture'}},
  plugins:{allow:['existing'],entries:{
    existing:{enabled:true},
    'memory-core':{config:{dreaming:{frequency:'0 3 * * *',phases:{light:{limit:10}}}}},
  }},
};
const paused=setMemorySchedule(before,false);
assert.equal(paused.plugins.entries['memory-core'].config.dreaming.enabled,false);
const resumed=setMemorySchedule(paused,true);
assert.equal(resumed.plugins.entries['memory-core'].config.dreaming.enabled,true);
delete paused.plugins.entries['memory-core'].config.dreaming.enabled;
assert.deepEqual(paused,before);
assert.equal(before.plugins.entries['memory-core'].config.dreaming.enabled,undefined);
console.log('Memory schedule control changes only the requested flag and preserves all other configuration.');
