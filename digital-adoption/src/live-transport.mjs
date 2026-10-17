import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
export function attachLiveTransport(server, {
  tasks,
  path = '/v1/live'
}) {
  const sockets = new Set(),
    wss = new WebSocketServer({
      noServer: true,
      maxPayload: 64000,
      perMessageDeflate: false
    });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== path || !req.headers.origin || sockets.size >= tasks.limits.instances) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws);
      let instanceId,
        busy = false,
        count = 0,
        windowAt = Date.now();
      const timeout = setTimeout(() => ws.terminate(), 5000);
      timeout.unref();
      const send = value => {
        if (ws.readyState !== 1 || ws.bufferedAmount > 128000) throw new Error('Transport unavailable');
        ws.send(JSON.stringify(value));
      };
      ws.on('error', () => {});
      ws.on('message', async (data, binary) => {
        try {
          if (binary || busy) throw new Error('Invalid frame');
          if (Date.now() - windowAt > 10000) {
            count = 0;
            windowAt = Date.now();
          }
          if (++count > 50) throw new Error('Frame limit');
          busy = true;
          const message = JSON.parse(data.toString());
          if (!instanceId) {
            if (message.type !== 'authenticate' || typeof message.ticket !== 'string') throw new Error('Authentication required');
            instanceId = tasks.connect(message.ticket, req.headers.origin, send);
            clearTimeout(timeout);
            send({
              type: 'connected',
              instanceId
            });
          } else if (message.type === 'heartbeat') send(tasks.heartbeat(instanceId));else if (['ack', 'result'].includes(message.type)) tasks.commandFrame(instanceId, message);else throw new Error('Invalid frame');
        } catch {
          ws.close(1008, 'Connection rejected');
        } finally {
          busy = false;
        }
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        sockets.delete(ws);
        if (instanceId) tasks.disconnect(instanceId);
      });
    });
  });
  const timer = setInterval(() => {
    tasks.maintain();
    tasks.cleanup().catch(() => {});
  }, 1000);
  timer.unref();
  server.on('close', () => {
    clearInterval(timer);
    for (const ws of sockets) ws.terminate();
    wss.close();
  });
  return {
    close() {
      for (const ws of sockets) ws.terminate();
    }
  };
}

// Private service-to-service listener, never published by Docker or nginx.
export function createTaskBridge({
  tasks,
  token
}) {
  if (typeof token !== 'string' || token.length < 40) throw new Error('Task bridge credential required');
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  return createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.origin || !timingSafeEqual(expected, createHash('sha256').update(req.headers.authorization || '').digest())) return send(403, {
        code: 'BRIDGE_DENIED'
      });
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return send(404, {
        code: 'NOT_FOUND'
      });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 64000) return send(413, {
          code: 'TOO_LARGE'
        });
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString()),
        userId = input.userId;
      if (typeof userId !== 'string' || !userId || userId.length > 160) throw new Error('Invalid user');
      if (req.url === '/link') return send(200, tasks.linkUser(userId, input));
      if (req.url === '/discover') return send(200, tasks.discover(userId));
      if (req.url === '/preflight') return send(200, tasks.preflight(userId, input));
      if (req.url === '/dispatch') return send(200, tasks.dispatch(userId, input, input.snapshot));
      if (req.url === '/status') return send(200, tasks.commandStatus(userId, input.commandId));
      if (req.url === '/finish-run') return send(200, tasks.finishRun(userId, input));
      return send(404, {
        code: 'NOT_FOUND'
      });
    } catch (error) {
      send(409, {
        code: error.publicCode || 'BRIDGE_OPERATION_FAILED'
      });
    }
  });
}
