import asyncio,json,threading,subprocess,time,urllib.request,os
from http.server import BaseHTTPRequestHandler,HTTPServer

calls=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  calls.append((self.path,self.headers.get('Authorization'),body.get('model')))
  assert 'user_config' not in body
  assert self.path=='/api/chat'
  assert body['options']['num_predict']==100 and body['options']['num_thread']==2 and body['options']['num_ctx']==8192
  assert body['truncate'] is False and body['think'] is False and body['format']=='json'
  data={'model':'fixture-model','created_at':'2026-11-11T00:00:00Z','message':{'role':'assistant','content':'{"ok":true}'},'done':True,'done_reason':'stop','prompt_eval_count':11,'eval_count':3}
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
 data={'model':'fixture-model','messages':[{'role':'user','content':'offline'}],'max_tokens':100,'num_thread':2,'num_ctx':8192,'truncate':False,'reasoning_effort':'none','response_format':{'type':'json_object'},'user_config':{'model_list':[{'model_name':'fixture-model','litellm_params':{'model':'ollama_chat/fixture-model','api_base':f'http://127.0.0.1:{server.server_port}','api_key':'ollama-local'}}],'num_retries':0,'max_fallbacks':0,'fallbacks':[]}}
 req=urllib.request.Request('http://127.0.0.1:18080/v1/chat/completions',data=json.dumps(data).encode(),headers={'Authorization':'Bearer sk-proxy-fixture','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:result=json.load(response)
 except urllib.error.HTTPError as error:
  print('FIXTURE_HTTP_ERROR',error.code,error.read().decode()[:1600]);raise
 assert result['usage']['total_tokens']==14 and len(calls)==1
 print('LITELLM_OLLAMA_HTTP_OK: native model, threads, context, output limit, non-thinking, JSON, truncate=false and measured usage preserved')
try:asyncio.run(main())
finally:
 proxy.terminate();proxy.wait(timeout=10);server.shutdown();log.close()
