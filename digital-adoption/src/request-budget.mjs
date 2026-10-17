// The stateful API is a singleton coordinator. Parser workers never own budgets.
// Do not replicate API coordinators until state/budgets use a shared database.
export function createRequestBudget({clock=Date.now}={}){
 const buckets=new Map();
 return {
  take(key,limit=30){
   const now=clock();let bucket=buckets.get(key);
   if(!bucket||bucket.until<=now){
    if(buckets.size>=10_000){for(const [id,b]of buckets)if(b.until<=now)buckets.delete(id);if(buckets.size>=10_000)throw new Error('Request capacity reached');}
    bucket={until:now+60_000,count:0};buckets.set(key,bucket);
   }
   if(bucket.count>=limit)throw new Error('Request rate exceeded');bucket.count++;
  }
 };
}

export function createConcurrencyBudget({global=25,perDomain=5}={}){
 if(!Number.isInteger(global)||global<1||global>1000||!Number.isInteger(perDomain)||perDomain<1||perDomain>global)throw new Error('Invalid concurrency capacity');
 let active=0;const domains=new Map();
 return {
  acquire(domain){
   if(active>=global||(domains.get(domain)||0)>=perDomain)throw new Error('Request capacity reached');
   active++;domains.set(domain,(domains.get(domain)||0)+1);let released=false;
   return ()=>{if(released)return;released=true;active--;const count=domains.get(domain)-1;if(count)domains.set(domain,count);else domains.delete(domain);};
  },
  current:()=>({active,domains:domains.size,global,perDomain}),
 };
}
