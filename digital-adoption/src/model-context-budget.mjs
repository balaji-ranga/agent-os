// One deployment setting for coordinator, gateway and checker input admission.
// This is a byte/traffic ceiling, not an output-token allowance or model window.
export function modelContextBytes(value){
 if(value===undefined)return 60000;
 const bytes=Number(value);
 if(!/^[0-9]+$/.test(String(value))||!Number.isInteger(bytes)||bytes<16000||bytes>128000)throw Error('ADOPTION_MODEL_CONTEXT_BYTES must be 16000..128000');
 return bytes;
}
export const MODEL_CONTEXT_BYTES=modelContextBytes(process.env.ADOPTION_MODEL_CONTEXT_BYTES);
export const MODEL_TRANSPORT_BYTES=MODEL_CONTEXT_BYTES+4096;
