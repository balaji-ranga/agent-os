export function pageRequest({offset=0,limit=25,query=''}={}) {
 if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof query!=='string'||query.length>200)throw new Error('Invalid page request');
 return {offset,limit,query:query.trim()};
}
export function pagination(total,{offset,limit}){return {offset,limit,total,hasNext:offset+limit<total,hasPrevious:offset>0};}
export function arrayPage(rows,input={},search=()=> ''){const request=pageRequest(input),needle=request.query.toLowerCase(),filtered=needle?rows.filter(row=>search(row).toLowerCase().includes(needle)):rows;return {items:filtered.slice(request.offset,request.offset+request.limit),pagination:pagination(filtered.length,request)};}
