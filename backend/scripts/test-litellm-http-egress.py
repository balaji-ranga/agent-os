import asyncio,json,threading,subprocess,time,urllib.request,os
from http.server import BaseHTTPRequestHandler,HTTPServer

calls=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  calls.append((self.path,self.headers.get('Authorization'),body.get('model')))
  assert 'user_config' not in body
  if self.path.endswith('/responses'):
   data={'id':'resp_fixture','object':'response','created_at':1,'status':'completed','model':'fixture-model','output':[{'type':'message','role':'assistant','id':'msg_fixture','status':'completed','content':[{'type':'output_text','text':'fixture','annotations':[]}]}],'usage':{'input_tokens':11,'output_tokens':3,'total_tokens':14}}
  else:
   data={'id':'chatcmpl-fixture','object':'chat.completion','created':1,'model':'fixture-model','choices':[{'index':0,'message':{'role':'assistant','content':'fixture'},'finish_reason':'stop'}],'usage':{'prompt_tokens':11,'completion_tokens':3,'total_tokens':14}}
  raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
config={'model_list':[{'model_name':'unused-fixture','litellm_params':{'model':'openai/unused-fixture','api_base':f'http://127.0.0.1:{server.server_port}/v1','api_key':'unused-fixture'}}],'general_settings':{'master_key':'sk-proxy-fixture','allow_client_side_credentials':True},'litellm_settings':{'set_verbose':False}}
open('/tmp/sk-proxy-fixture.json','w').write(json.dumps(config))
log=open('/tmp/sk-proxy-fixture.log','w')
proxy=subprocess.Popen(['litellm','--config','/tmp/sk-proxy-fixture.json','--host','127.0.0.1','--port','18080'],stdout=log,stderr=log)
for _ in range(45):
 try:
  urllib.request.urlopen('http://127.0.0.1:18080/health/liveliness',timeout=1);break
 except Exception:
  if proxy.poll() is not None:raise RuntimeError('Proxy startup failed')
  time.sleep(1)
else:raise RuntimeError('Proxy startup timed out')
async def main():
 for kind,key in [('acompletion','owner-a-fixture'),('aresponses','owner-b-fixture')]:
  data={'model':'fixture-model','user_config':{'model_list':[{'model_name':'fixture-model','litellm_params':{'model':'openai/fixture-model','api_base':f'http://127.0.0.1:{server.server_port}/v1','api_key':key}}],'num_retries':0,'max_fallbacks':0,'fallbacks':[]}}
  data.update({'messages':[{'role':'user','content':'offline'}]} if kind=='acompletion' else {'input':'offline'})
  endpoint='chat/completions' if kind=='acompletion' else 'responses'
  req=urllib.request.Request('http://127.0.0.1:18080/v1/'+endpoint,data=json.dumps(data).encode(),headers={'Authorization':'Bearer sk-proxy-fixture','Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=20) as response:result=json.load(response)
  except urllib.error.HTTPError as error:
   print('FIXTURE_HTTP_ERROR',error.code,error.read().decode()[:1500]);raise
  assert result['usage']['total_tokens']==14
 assert len(calls)==2
 assert [x[1] for x in calls]==['Bearer owner-a-fixture','Bearer owner-b-fixture']
 print('LITELLM_HTTP_EGRESS_OK: installed Chat and Responses routing, distinct BYOK credentials, preserved model and usage; two local requests only')
try:asyncio.run(main())
finally:
 proxy.terminate();proxy.wait(timeout=10);server.shutdown();log.close()
