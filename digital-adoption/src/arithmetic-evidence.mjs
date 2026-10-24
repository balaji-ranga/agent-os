// Compute literal arithmetic for the semantic reviewer. No eval, page-specific
// extraction or task routing. The judge distinguishes assertions from quotes.
export function arithmeticEvidence(message) {
 const number='[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
 const pattern=new RegExp(`(${number})\\s*([+*/÷×−-])\\s*(${number})\\s*=\\s*(?:approximately\\s+|about\\s+|~\\s*)?(${number})`,'gi'),checks=[];
 for(const match of String(message).slice(0,8000).matchAll(pattern)){
  if(checks.length===8)break;
  const [a,b,claimed]=[match[1],match[3],match[4]].map(n=>Number(n.replaceAll(',',''))),op=match[2];
  const computed=op==='+'?a+b:['-','−'].includes(op)?a-b:['*','×'].includes(op)?a*b:a/b;
  if(![a,b,claimed,computed].every(Number.isFinite)||Math.max(Math.abs(a),Math.abs(b),Math.abs(computed))>1e12)continue;
  const precision=Math.min(10,match[4].split('.')[1]?.length||0),rounded=Number(computed.toFixed(precision));
  checks.push({expression:`${a} ${op} ${b}`,claimed,computed:Number(computed.toPrecision(12)),roundedToClaimPrecision:rounded,ceiling:Math.ceil(computed),matchesRoundedValue:Math.abs(rounded-claimed)<=Number.EPSILON*Math.max(1,Math.abs(claimed))*8});
 }
 return checks;
}
