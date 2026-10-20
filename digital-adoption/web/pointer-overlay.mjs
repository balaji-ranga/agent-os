// Visual feedback only: this module never activates, focuses or edits host controls.
// The caller shows activation feedback only at an already-authorized dispatch.
export function createPointerOverlay(document){
 const view=document.defaultView;let cleanup=()=>{},previous,activeMode;
 function clear(){cleanup();cleanup=()=>{};activeMode=null;}
 function show(element,{label='',mode='guide',valid=()=>true}={}){
  clear();if(!element?.isConnected||!document.body)return;activeMode=mode;
  const marker=document.createElement('div'),caption=document.createElement('span'),pointer=document.createElement('span'),ring=document.createElement('span');
  marker.dataset.adoptionWidget='true';marker.dataset.adoptionHighlight='true';marker.dataset.adoptionFeedback=mode;marker.setAttribute('role','status');marker.setAttribute('aria-live','polite');
  marker.style.cssText='all:initial;box-sizing:border-box;position:fixed;pointer-events:none;z-index:2147483645;border:3px solid #3459cf;border-radius:6px;box-shadow:0 0 0 3px white';
  caption.textContent=`${mode==='guide'?'Next':mode==='activate'?'Activating':'Applying'}: ${label}`;
  caption.style.cssText='all:initial;box-sizing:border-box;position:absolute;pointer-events:none;max-width:300px;background:#172440;color:white;padding:4px 8px;border-radius:5px;font:13px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  pointer.dataset.adoptionPointer='true';pointer.setAttribute('aria-hidden','true');pointer.style.cssText='all:initial;position:absolute;pointer-events:none;width:28px;height:34px;filter:drop-shadow(0 1px 2px #17244080)';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 28 34');svg.setAttribute('width','28');svg.setAttribute('height','34');path.setAttribute('d','M2 2 L2 27 L9 21 L15 32 L20 29 L14 19 L24 18 Z');path.setAttribute('fill','#3459cf');path.setAttribute('stroke','white');path.setAttribute('stroke-width','2');svg.append(path);pointer.append(svg);
  ring.dataset.adoptionClick='true';ring.setAttribute('aria-hidden','true');ring.hidden=mode!=='activate';ring.style.cssText='all:initial;box-sizing:border-box;position:absolute;pointer-events:none;width:30px;height:30px;border:3px solid #3459cf;border-radius:50%;opacity:0';
  marker.append(caption,ring,pointer);document.body.append(marker);
  const motion=view.matchMedia?.('(prefers-reduced-motion: reduce)');let frame,timer,animations=[],last=0,started=false;
  const cancelMotion=()=>{for(const a of animations)a.cancel();animations=[];};
  const position=(animate=false)=>{
   if(!element.isConnected||element.hidden||!element.getClientRects().length||view.getComputedStyle(element).visibility==='hidden'||!valid()){clear();return;}
   const b=element.getBoundingClientRect(),w=view.innerWidth,h=view.innerHeight;
   marker.style.display=b.bottom<=0||b.right<=0||b.top>=h||b.left>=w?'none':'block';
   Object.assign(marker.style,{left:`${b.left-3}px`,top:`${b.top-3}px`,width:`${b.width+6}px`,height:`${b.height+6}px`});
   const x=Math.max(0,Math.min(b.width/2,w-30-b.left)),y=Math.max(0,Math.min(b.height/2,h-36-b.top));
   Object.assign(pointer.style,{left:`${x}px`,top:`${y}px`});Object.assign(ring.style,{left:`${x-15}px`,top:`${y-15}px`});
   Object.assign(caption.style,{left:`${Math.max(-b.left+4,Math.min(0,w-310-b.left))}px`,maxWidth:`${Math.min(300,w-16)}px`,bottom:b.top>40?'calc(100% + 4px)':'auto',top:b.top>40?'auto':'calc(100% + 4px)'});
   if(animate&&!motion?.matches&&pointer.animate){
    const from=previous?{x:Math.max(-120,Math.min(120,previous.x-b.left-x)),y:Math.max(-100,Math.min(100,previous.y-b.top-y))}:{x:-48,y:28};
    animations.push(pointer.animate([{transform:`translate(${from.x}px,${from.y}px)`,opacity:.3},{transform:'translate(0,0)',opacity:1}],{duration:360,easing:'cubic-bezier(.2,.8,.2,1)'}));
    if(mode==='activate')animations.push(ring.animate([{opacity:0,transform:'scale(.4)'},{opacity:.9,transform:'scale(1)',offset:.35},{opacity:0,transform:'scale(1.8)'}],{duration:650,iterations:1}));
   }
   previous={x:b.left+x,y:b.top+y};
  };
  const track=now=>{if(now-last>=100){last=now;position();}if(started)frame=view.requestAnimationFrame(track);};
  const reposition=()=>position(),motionChanged=()=>{cancelMotion();position();};
  cleanup=()=>{started=false;view.cancelAnimationFrame(frame);view.clearTimeout(timer);cancelMotion();view.removeEventListener('scroll',reposition,true);view.removeEventListener('resize',reposition);motion?.removeEventListener?.('change',motionChanged);marker.remove();};
  started=true;position(true);if(started){view.addEventListener('scroll',reposition,true);view.addEventListener('resize',reposition);motion?.addEventListener?.('change',motionChanged);frame=view.requestAnimationFrame(track);timer=view.setTimeout(clear,mode==='guide'?10000:1600);}
 }
 return {show,clear,clearGuidance(){if(activeMode==='guide')clear();},destroy:clear};
}
