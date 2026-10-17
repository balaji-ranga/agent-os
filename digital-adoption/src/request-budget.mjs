// Bounded single-process protection for the initial independent instance.
// Multi-replica deployment must replace this with a shared atomic budget.
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
