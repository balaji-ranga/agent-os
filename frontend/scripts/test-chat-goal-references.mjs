import assert from 'node:assert/strict';
import { collectGoalRunIds } from '../src/utils/chatGoalReferences.js';
const id='agr-4ccceaf1586745a0', other='agr-ea14567602a44934';
assert.deepEqual(collectGoalRunIds({text:'Hacker News results',toolCalls:[{tool_name:'agent_goal_list',status:'ok',response:{goals:[{id},{id:other}]}}]}),[]);
assert.deepEqual(collectGoalRunIds({toolCalls:[{tool_name:'agent_goal_create',status:'ok',response:{goal:{id},context:{previous:other}}}]}),[id]);
assert.deepEqual(collectGoalRunIds({toolCalls:[{tool_name:'agent_goal_status',status:'ok',request:{goal_run_id:id},response:{goals:[{id:other}]}}]}),[id]);
assert.deepEqual(collectGoalRunIds({text:`Created goal ${id}`,toolCalls:[{tool_name:'agent_goal_create',status:'error',response:{id:other}}]}),[id]);
console.log('Chat goal cards: list results do not create unrelated panels; explicit/create/status references preserved');
