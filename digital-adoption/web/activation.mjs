// One reviewed activation, with no fallback event sequence or automatic retry.
export function activateNavigation(element,phase='click'){
 if(!['click','mousedown','pointerdown'].includes(phase))throw new Error('Unsupported interaction profile; use this control manually');
 if(phase==='click'){element.click();return;}
 const view=element.ownerDocument?.defaultView,EventType=phase==='pointerdown'?view?.PointerEvent:view?.MouseEvent;
 if(!EventType)throw new Error('This interaction profile is unavailable; use the control manually');
 element.dispatchEvent(new EventType(phase,{bubbles:true,cancelable:true,button:0,buttons:1,pointerType:'mouse',isPrimary:true}));
}
