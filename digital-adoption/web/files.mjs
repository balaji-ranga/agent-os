const types={md:'text/markdown',txt:'text/plain',html:'text/html',htm:'text/html',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',mp4:'video/mp4',webm:'video/webm'};
export async function encodeFile(file){
 if(!file?.size||file.size>16*1024*1024||!types[file.name.split('.').pop().toLowerCase()])throw new Error('Choose a supported file up to 16 MB.');
 const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('File could not be read'));reader.readAsDataURL(file);});
 return {filename:file.name,mime:types[file.name.split('.').pop().toLowerCase()],content};
}
