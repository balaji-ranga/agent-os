import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubmitController} from '../web/form-submit.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {openRepository} from '../src/repository.mjs';
function host(){
 let clicks=0,status='';const field={name:'company',type:'text',value:'Cedar',checked:false,disabled:false,required:true};
 const form={elements:[field],isConnected:true,action:'https://host.example.test/customers',method:'post',target:'',checkValidity:()=>true};
 const button={type:'submit',form,isConnected:true,textContent:'Save customer',getAttribute:()=>null,click(){clicks++;status='Customer saved successfully';}};
 const document={location:{href:'https://host.example.test/customers',origin:'https://host.example.test',pathname:'/customers'},querySelectorAll:s=>s==='button,input[type="submit"]'?[button]:[{textContent:status}]};
 const controller=createSubmitController(document,{visible:()=>true,excluded:()=>false});return {controller,field,form,button,clicks:()=>clicks};
}
test('native Save requires exact approval, dispatches once and distinguishes reported status from business verification',async()=>{
 const h=host(),ref=h.controller.snapshot(1)[0].ref;await assert.rejects(()=>h.controller.submit({ref,expectedRevision:1,approved:false}));assert.equal(h.clicks(),0);
 const result=await h.controller.submit({ref,expectedRevision:1,approved:true});assert.equal(h.clicks(),1);assert.equal(result.hostReported,'success');assert.equal(result.businessVerified,false);
 await assert.rejects(()=>h.controller.submit({ref,expectedRevision:1,approved:true}));assert.equal(h.clicks(),1);
});
test('changed values, control identity, destination, cancellation and invalid host forms block Save before dispatch',async()=>{
 for(const mutate of [h=>h.field.value='Changed',h=>h.form.action='https://foreign.example.test/',h=>h.form.elements=[{...h.field}],h=>h.form.checkValidity=()=>false]){
  const h=host(),ref=h.controller.snapshot(1)[0].ref;mutate(h);await assert.rejects(()=>h.controller.submit({ref,expectedRevision:1,approved:true}));assert.equal(h.clicks(),0);
 }
 const h=host(),ref=h.controller.snapshot(1)[0].ref;await assert.rejects(()=>h.controller.submit({ref,expectedRevision:1,approved:true,active:()=>false}));assert.equal(h.clicks(),0);
});
test('sensitive forms and external destinations are never offered as supported Save controls',()=>{
 const sensitive=host();sensitive.field.type='password';assert.equal(sensitive.controller.snapshot(1).length,0);
 const external=host();external.form.action='https://external.example.test/';assert.equal(external.controller.snapshot(1).length,0);
});
test('models cannot create Save actions; user-requested Save approvals remain session bound',()=>{
 const repository=openRepository();try{
  const proposals=createProposalStore(repository),scope={embeddingId:'A',sessionId:'one'},snapshot={revision:1,fields:[],submissions:[{ref:'r1s0',label:'Save'}]};
  assert.throws(()=>proposals.prepare(scope,snapshot,{message:'Save',actions:[{type:'submit',ref:'r1s0'}]}));
  const proposal=proposals.prepareSave(scope,snapshot,'r1s0');assert.throws(()=>proposals.consume({...scope,sessionId:'two'},{id:proposal.id,revision:1,approved:true}));
  assert.equal(proposals.consume(scope,{id:proposal.id,revision:1,approved:true}).actions[0].type,'submit');assert.throws(()=>proposals.consume(scope,{id:proposal.id,revision:1,approved:true}));
 }finally{repository.close();}
});
