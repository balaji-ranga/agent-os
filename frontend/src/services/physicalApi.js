import {getAuthToken} from '../api';
export const physicalBase=`${import.meta.env.VITE_API_URL||'/api'}/physical`;
export async function physicalRequest(path='',{method='GET',body,binary=false,signal}={}){
 const response=await fetch(physicalBase+path,{method,signal,headers:{Authorization:`Bearer ${getAuthToken()}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
 if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||`Physical AI request failed (${response.status})`);}
 return binary?response.blob():response.json();
}
