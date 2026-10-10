import assert from 'node:assert/strict';
import { toolsForChatTurn } from '../src/services/chat-tool-calls.js';
const turn={role:'assistant',work_unit_id:'news-work',created_at:'2026-10-10 09:41:23'};
const calls=[
  {id:1,tool_name:'agent_goal_list',created_at:'2026-10-10 07:20:00',request:{}},
  {id:2,tool_name:'download_pdf',created_at:'2026-10-10 08:30:00',request:{}},
  {id:3,tool_name:'connector_execute_action',created_at:'2026-10-10 09:41:05',request:{}},
  {id:4,tool_name:'agent_goal_create',created_at:'2026-10-10 09:41:06',request:{_work_unit_id:'other-work'}},
  {id:5,tool_name:'connector_get_action_guide',created_at:'2026-10-10 09:41:07',request:{_work_unit_id:'news-work'}},
  {id:6,tool_name:'agent_goal_list',created_at:'2026-10-10 09:42:00',request:{}},
];
assert.deepEqual(toolsForChatTurn(turn,calls,{work:{created_at:'2026-10-10 09:40:56'},legacyFrom:'2026-10-10 06:41:23'}).map(c=>c.id),[3,5]);
assert.deepEqual(toolsForChatTurn({...turn,work_unit_id:null},calls,{legacyFrom:'2026-10-10 09:40:56'}).map(c=>c.id),[3,6],'pre-linkage history retains its existing timestamp padding');
console.log('Chat tool attribution: exact work isolation, bounded legacy receipts, no future-tool contamination passed');
