#!/usr/bin/env node
/**
 * Heal Kanban cards stuck in awaiting_confirmation after linked delegation finished.
 * Usage: node scripts/heal-stuck-kanban-delegations.js
 */
import { initDb } from '../src/db/schema.js';
import { healStuckKanbanForCompletedDelegations } from '../src/services/kanban-workflow-stage.js';

initDb();
const out = healStuckKanbanForCompletedDelegations();
console.log('HEAL_STUCK_KANBAN_OK', out);
