// Model-only diagnostic using synthetic evidence; run inside the gateway image.
// Reads the existing route settings; never prints credentials or changes them.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createPlatformGateway} from '/adoption/integrations/platform-gateway.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {createKnowledgeAnswer} from '/adoption/src/knowledge-answer.mjs';
const config=JSON.parse(readFileSync('/config/gateway.json','utf8')),database=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),complete=createProviderCompletion(),events=[];
const gateway=createPlatformGateway({serviceToken:config.serviceToken,resolveActive:async()=>resolveGatewaySettings(database,config),complete:async input=>{const out=await complete(input);events.push({stage:input.outputSchema?'checker':'maker',content:out.content});return out;}});
const answer=createKnowledgeAnswer({gatewayUrl:'https://model.example.test/complete',serviceToken:config.serviceToken,fetchImpl:async(_url,input)=>new Response(JSON.stringify(await gateway({authorization:input.headers.Authorization,body:JSON.parse(input.body),signal:input.signal})),{headers:{'Content-Type':'application/json'}})});
try{const result=await answer({text:'From my private uploaded onboarding files, what company name and region should I use? Cite the source.',evidence:[{chunkId:'synthetic:1',title:'onboarding.docx',locator:'Document paragraphs',text:'Company name: Synthetic Orchid\nContact email: orchid@example.test\nRegion: Singapore\nRequested integration: Inventory API\nTransport: HTTP\nTitle: Delivery handoff\nBody: Prepare a shipment for Synthetic Orchid'}]});console.log(JSON.stringify({events,result},null,2));}finally{database.close();}
