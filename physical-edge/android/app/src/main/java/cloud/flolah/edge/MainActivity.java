package cloud.flolah.edge;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.view.WindowManager;
import android.util.AtomicFile;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.io.*;
import okhttp3.*;

public class MainActivity extends Activity {
 private WebView web; private boolean loaded=false; private final Map<String,WebSocket> sockets=new ConcurrentHashMap<>();
 private final OkHttpClient client=new OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
 @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON|WindowManager.LayoutParams.FLAG_SECURE);
  WebView.setWebContentsDebuggingEnabled(false);web=new WebView(this);setContentView(web);
  web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
  web.addJavascriptInterface(new NativeBridge(),"NativeEdge");web.loadUrl("file:///android_asset/index.html");loaded=true;
 }
 private void event(String id,String type,String data){runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.nativeSocketEvent("+JSONObject.quote(id)+","+JSONObject.quote(type)+","+JSONObject.quote(data)+")",null);});}
 class NativeBridge {
  @JavascriptInterface public synchronized String read(String name){if(!name.matches("[a-z-]{1,32}"))throw new IllegalArgumentException();try{return new String(new AtomicFile(new File(getFilesDir(),name+".json")).readFully(),StandardCharsets.UTF_8);}catch(IOException e){return "null";}}
  @JavascriptInterface public synchronized void write(String name,String value){if(!name.matches("[a-z-]{1,32}")||value.length()>8000000)throw new IllegalArgumentException();AtomicFile file=new AtomicFile(new File(getFilesDir(),name+".json"));FileOutputStream stream=null;try{stream=file.startWrite();stream.write(value.getBytes(StandardCharsets.UTF_8));file.finishWrite(stream);}catch(IOException e){file.failWrite(stream);throw new IllegalStateException("Private journal write failed");}}
  @JavascriptInterface public String sha256(String text){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format("%02x",b));return s.toString();}catch(Exception e){throw new IllegalStateException();}}
  @JavascriptInterface public String uuid(){return UUID.randomUUID().toString();}
  @JavascriptInterface public void open(String id,String url,String headers){try{
    HttpUrl parsed=HttpUrl.get(url.replaceFirst("^wss:","https:"));if(!url.startsWith("wss://")||!parsed.username().isEmpty()||!parsed.password().isEmpty()||parsed.query()!=null||parsed.fragment()!=null||sockets.size()>=4)throw new IllegalArgumentException();
    Request.Builder request=new Request.Builder().url(url);JSONObject h=new JSONObject(headers);Iterator<String> keys=h.keys();while(keys.hasNext()){String key=keys.next();if(!key.equals("Authorization")&&!key.equals("X-Flolah-Hub"))throw new IllegalArgumentException();request.header(key,h.getString(key));}
    WebSocket socket=client.newWebSocket(request.build(),new WebSocketListener(){@Override public void onOpen(WebSocket ws,Response r){event(id,"open","");}@Override public void onMessage(WebSocket ws,String text){if(text.length()>1048576){ws.close(1009,"Payload too large");return;}event(id,"message",text);}@Override public void onClosed(WebSocket ws,int code,String reason){sockets.remove(id);event(id,"close","");}@Override public void onFailure(WebSocket ws,Throwable error,Response r){sockets.remove(id);event(id,"error","");event(id,"close","");}});sockets.put(id,socket);
   }catch(Exception e){event(id,"error","");event(id,"close","");}}
  @JavascriptInterface public void send(String id,String message){WebSocket socket=sockets.get(id);if(socket!=null&&message.length()<=1048576)socket.send(message);}
  @JavascriptInterface public void close(String id){WebSocket socket=sockets.remove(id);if(socket!=null)socket.close(1000,"Stopped");}
 }
 @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.stopEdge&&window.stopEdge()",null);web.onPause();}for(WebSocket s:sockets.values())s.cancel();sockets.clear();super.onPause();}
 @Override protected void onResume(){super.onResume();if(loaded&&web!=null){web.onResume();web.reload();}}
 @Override protected void onDestroy(){for(WebSocket s:sockets.values())s.cancel();sockets.clear();if(web!=null){web.removeJavascriptInterface("NativeEdge");web.destroy();web=null;}super.onDestroy();}
}
