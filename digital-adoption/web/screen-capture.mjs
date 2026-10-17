// This module never captures on import, resume, or widget initialization.
export function createScreenCapture({mediaDevices=navigator.mediaDevices,Recorder=globalThis.MediaRecorder,onChange=()=>{},maxBytes=16*1024*1024,maxMs=120_000}={}){
 let stream,recorder,chunks=[],bytes=0,blob=null,state='idle',timer,requested=false,discarded=false;
 const notify=()=>onChange({state,blob,bytes});
 const release=()=>{clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;};
 const capture={
  async start(){
   if(requested||['recording','paused','requesting'].includes(state))throw new Error('Capture already active');
   if(!mediaDevices?.getDisplayMedia||!Recorder)throw new Error('Screen capture is unavailable. Upload an existing silent MP4/WebM recording instead.');
   state='requesting';requested=true;discarded=false;notify();
   try{
    // Called directly by the user's capture button; browser consent is mandatory.
    stream=await mediaDevices.getDisplayMedia({video:true,audio:false});
    if(discarded){release();requested=false;state='discarded';notify();return;}
    chunks=[];bytes=0;blob=null;
    const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>Recorder.isTypeSupported(type));
    if(!mime)throw new Error('No supported capture format. Upload an existing recording.');
    recorder=new Recorder(stream,{mimeType:mime,videoBitsPerSecond:600_000});
    recorder.ondataavailable=event=>{if(event.data.size){bytes+=event.data.size;if(bytes>maxBytes){discarded=true;capture.stop();}else chunks.push(event.data);}};
    recorder.onstop=()=>{release();blob=discarded?null:new Blob(chunks,{type:mime.split(';')[0]});chunks=[];state=discarded?'discarded':'review';requested=false;notify();};
    recorder.onerror=()=>{discarded=true;capture.stop();};
    for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>capture.stop(),{once:true});
    recorder.start(1000);state='recording';timer=setTimeout(()=>capture.stop(),maxMs);notify();
   }catch(error){release();requested=false;state='idle';notify();throw error;}
  },
  pause(){if(state!=='recording')throw new Error('Capture is not recording');recorder.pause();state='paused';notify();},
  resume(){if(state!=='paused')throw new Error('Capture is not paused');recorder.resume();state='recording';notify();},
  stop(){if(recorder&&recorder.state!=='inactive')recorder.stop();else{release();requested=false;if(state!=='review')state='idle';notify();}},
  discard(){discarded=true;blob=null;chunks=[];if(recorder&&recorder.state!=='inactive')recorder.stop();release();state='discarded';notify();},
  state:()=>state,
 };
 return capture;
}
