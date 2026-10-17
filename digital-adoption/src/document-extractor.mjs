import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
export function createDocumentExtractor({python='python3',timeoutMs=120_000}={}){
 return async({path,kind})=>{
  const {stdout}=await execute(python,['-I',fileURLToPath(new URL('./extract-document.py',import.meta.url)),path,kind],{
   timeout:timeoutMs,maxBuffer:2_000_000,windowsHide:true,env:{...process.env,OMP_THREAD_LIMIT:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'},
  });
  const result=JSON.parse(stdout);
  if(!Array.isArray(result.sections)||!result.sections.length||result.sections.length>300||result.sections.some(s=>typeof s.text!=='string'||typeof s.locator!=='string'))throw new Error('No supported document content extracted');
  return result;
 };
}
