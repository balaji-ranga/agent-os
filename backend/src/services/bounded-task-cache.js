// Disposable acceleration only: durable task rows remain authoritative.
export class BoundedTaskCache {
  constructor({maxEntries=256,maxBytes=4*1024*1024,ttlMs=15*60*1000}={}) {
    this.rows=new Map();this.bytes=0;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.ttlMs=ttlMs;
    this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();
  }
  delete(key){const row=this.rows.get(key);if(row){this.bytes-=row.bytes;this.rows.delete(key);}}
  prune(){const now=Date.now();for(const [key,row] of this.rows)if(row.expires<=now)this.delete(key);}
  get(key){this.prune();return this.rows.get(key)?.value;}
  set(key,value){
    this.prune();this.delete(key);
    const bytes=Buffer.byteLength(JSON.stringify(value),'utf8')+Buffer.byteLength(String(key),'utf8');
    if(bytes>this.maxBytes)return this;
    while(this.rows.size>=this.maxEntries||this.bytes+bytes>this.maxBytes)this.delete(this.rows.keys().next().value);
    this.rows.set(key,{value,bytes,expires:Date.now()+this.ttlMs});this.bytes+=bytes;return this;
  }
}
