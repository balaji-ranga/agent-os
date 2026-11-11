import asyncio,json,threading,subprocess,time,urllib.request,os
from http.server import BaseHTTPRequestHandler,HTTPServer

calls=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  rawbody=self.rfile.read(int(self.headers['Content-Length']))
  calls.append((self.path,self.headers.get('Authorization'),rawbody.decode()))
  if self.path.endswith('/client_secrets'):
   body=json.loads(rawbody);assert body['session']['model']=='gpt-realtime'
   raw=json.dumps({'value':'ek-fixture-only','expires_at':int(time.time())+300}).encode();ctype='application/json'
  else:
   assert self.path.endswith('/calls');assert b'v=0' in rawbody
   raw=b'v=0\r\na=fixture-answer';ctype='application/sdp'
  self.send_response(200);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
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
 data={'session':{'type':'realtime','model':'gpt-realtime'},'user_config':{'model_list':[{'model_name':'gpt-realtime','litellm_params':{'model':'openai/gpt-realtime','api_base':f'http://127.0.0.1:{server.server_port}/v1','api_key':'owner-a-fixture'}}],'num_retries':0,'max_fallbacks':0,'fallbacks':[]}}
 req=urllib.request.Request('http://127.0.0.1:18080/v1/realtime/client_secrets',data=json.dumps(data).encode(),headers={'Authorization':'Bearer sk-proxy-fixture','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:result=json.load(response)
  secret=result['value'];assert secret!='ek-fixture-only' and 'owner-a-fixture' not in secret
  req=urllib.request.Request('http://127.0.0.1:18080/v1/realtime/calls',data=b'v=0\r\na=fixture-offer',headers={'Authorization':'Bearer '+secret,'Content-Type':'application/sdp'})
  with urllib.request.urlopen(req,timeout=20) as response:assert response.read()==b'v=0\r\na=fixture-answer'
 except urllib.error.HTTPError as error:
  print('FIXTURE_HTTP_ERROR',error.code,error.read().decode()[:1600]);raise
 assert len(calls)==2
 assert [x[1] for x in calls]==['Bearer owner-a-fixture','Bearer ek-fixture-only']
 print('LITELLM_REALTIME_HTTP_OK: scoped BYOK mint and encrypted ephemeral SDP route, no durable key in session token, two loopback requests only')
try:asyncio.run(main())
finally:
 proxy.terminate();proxy.wait(timeout=10);server.shutdown();log.close()
