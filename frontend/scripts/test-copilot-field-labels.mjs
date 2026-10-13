import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {sourceFieldLabel} from './copilot-field-labels.mjs';
const {parse}=createRequire(import.meta.url)('@babel/parser');
function labels(source){
  const found=[];
  function walk(node,anc=[]){
    if(!node||typeof node!=='object')return;
    if(node.type==='JSXOpeningElement'&&['input','textarea','select'].includes(node.name?.name))found.push(sourceFieldLabel(node,anc));
    for(const [key,value] of Object.entries(node))if(!['loc','start','end'].includes(key)){if(Array.isArray(value))value.forEach(v=>walk(v,[...anc,node]));else if(value&&typeof value==='object')walk(value,[...anc,node]);}
  }
  walk(parse(source,{sourceType:'module',plugins:['jsx']}));return found;
}
assert.deepEqual(labels('<Field label="Campaign name"><input placeholder="Example campaign" /></Field>'),['Campaign name']);
assert.deepEqual(labels('<label>Outcome goal<textarea placeholder="Example outcome" /></label>'),['Outcome goal']);
assert.deepEqual(labels('<FormField label="Description"><input aria-label="Short description" /></FormField>'),['Short description']);
assert.deepEqual(labels('<section title="Not a label"><input value="Private value" /></section>'),['Unlabelled or dynamically labelled control']);
assert.deepEqual(labels('<Field label={dynamic}><input placeholder="Fallback" /></Field>'),['Fallback']);
assert.deepEqual(labels('<label><span>Name</span><input placeholder="Example name" /><small>Not the label</small></label>'),['Name']);
assert.deepEqual(labels('<label><span><strong>Description</strong></span><textarea /></label>'),['Description']);
assert.deepEqual(labels('<label><span>{privateValue}</span><input value={privateValue} /></label>'),['Unlabelled or dynamically labelled control']);
const inputNode=parse('<input id="display-name" placeholder="Example" />',{plugins:['jsx']}).program.body[0].expression.openingElement;
assert.equal(sourceFieldLabel(inputNode,[],new Map([['display-name','Display name']])),'Display name');
assert.equal(sourceFieldLabel(inputNode,[],new Map([['display-name',null]])),'Example','Ambiguous explicit labels must not win');
console.log('PASS source field labels: shared wrappers, explicit labels before examples, no values or arbitrary headings.');
