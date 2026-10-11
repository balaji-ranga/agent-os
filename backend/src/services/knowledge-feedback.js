import {randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
export function knowledgeFeedback(db=getDb()){
  db.exec('CREATE TABLE IF NOT EXISTS knowledge_feedback(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,query TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS knowledge_feedback_owner ON knowledge_feedback(owner,created_at,id)');
  return {
    save(owner,input){
      if(!owner||!['wrong_evidence','missing_evidence','helpful'].includes(input.kind)||typeof input.query!=='string'||input.query.length>4000||typeof input.note!=='string'||input.note.length>2000)throw new Error('Choose feedback type and enter up to 2000 characters');
      const id=randomUUID();db.prepare('INSERT INTO knowledge_feedback VALUES(?,?,?,?,?,?)').run(id,owner,input.kind,input.query,input.note,new Date().toISOString());return {id};
    },
    page(owner,after=''){if(typeof after!=='string'||after.length>100)throw new Error('Invalid feedback cursor');const items=db.prepare('SELECT * FROM knowledge_feedback WHERE owner=? AND id>? ORDER BY id LIMIT 26').all(owner,after);return {items:items.slice(0,25),next:items.length>25?items[24].id:null};},
  };
}
