import { randomUUID } from 'crypto';
import { lookup } from 'dns/promises';

const toBuffer = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value ?? null));
const safeJson = (value) => { try { return JSON.parse(value); } catch { return value; } };
function normalizedEnvelope({ protocol, destination, payload, headers = {}, messageId, key = '', correlationId = '', replyTo = '', timestamp }) {
  return { protocol, destination, payload: safeJson(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '')), headers, messageId: messageId || randomUUID(), key, correlationId, replyTo, timestamp: timestamp || new Date().toISOString() };
}
function authUrl(connection) {
  const url = new URL(connection.endpoint);
  const credentials = connection.credentials || {};
  if (credentials.username) url.username = credentials.username;
  if (credentials.password) url.password = credentials.password;
  return url.toString();
}

async function mqttAdapter(connection) {
  const mqtt = await import('mqtt');
  const options = { clientId: connection.credentials?.clientId || connection.config?.clientId, username: connection.credentials?.username, password: connection.credentials?.password, reconnectPeriod: 5000 };
  const connect = () => mqtt.connect(connection.endpoint, options);
  return {
    async test() { const client = connect(); await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); }); await client.endAsync(); },
    async publish(request) { const client = await mqtt.connectAsync(connection.endpoint, options); await client.publishAsync(request.destination, toBuffer(request.payload), { qos: Number(request.qos ?? 1), retain: !!request.retain, properties: { userProperties: request.headers || {}, correlationData: request.correlationId ? Buffer.from(request.correlationId) : undefined, responseTopic: request.replyTo || undefined } }); await client.endAsync(); return { messageId: request.correlationId || randomUUID() }; },
    async subscribe(subscription, onMessage) { const client = await mqtt.connectAsync(connection.endpoint, options); await client.subscribeAsync(subscription.destination, { qos: Number(subscription.options?.qos ?? 1) }); client.on('message', (topic, payload, packet) => onMessage(normalizedEnvelope({ protocol: 'mqtt', destination: topic, payload, headers: packet.properties?.userProperties || {}, messageId: packet.messageId, correlationId: packet.properties?.correlationData?.toString(), replyTo: packet.properties?.responseTopic }))); return async () => client.endAsync(); },
  };
}

async function amqp091Adapter(connection) {
  const amqp = await import('amqplib');
  const connect = () => amqp.connect(authUrl(connection));
  return {
    async test() { const conn = await connect(); await conn.close(); },
    async publish(request) { const conn = await connect(); try { const ch = await conn.createConfirmChannel(); const id = request.correlationId || randomUUID(); if (request.destinationType === 'topic') { const exchange = connection.config?.exchange || request.destination; await ch.assertExchange(exchange, connection.config?.exchangeType || 'topic', { durable: request.persistent !== false }); ch.publish(exchange, request.key || '', toBuffer(request.payload), { messageId: id, correlationId: request.correlationId, replyTo: request.replyTo, headers: request.headers, persistent: request.persistent !== false, expiration: request.ttlMs }); } else { await ch.assertQueue(request.destination, { durable: request.persistent !== false }); ch.sendToQueue(request.destination, toBuffer(request.payload), { messageId: id, correlationId: request.correlationId, replyTo: request.replyTo, headers: request.headers, persistent: request.persistent !== false, expiration: request.ttlMs }); } await ch.waitForConfirms(); return { messageId: id }; } finally { await conn.close(); } },
    async subscribe(subscription, onMessage) { const conn = await connect(); const ch = await conn.createChannel(); let queue = subscription.destination; if (subscription.destinationType === 'topic') { const exchange = connection.config?.exchange || subscription.destination; await ch.assertExchange(exchange, connection.config?.exchangeType || 'topic', { durable: true }); const q = await ch.assertQueue(connection.config?.queue || '', { exclusive: !connection.config?.queue, durable: !!connection.config?.queue }); queue = q.queue; await ch.bindQueue(queue, exchange, subscription.options?.routingKey || '#'); } else await ch.assertQueue(queue, { durable: true }); await ch.prefetch(Number(subscription.options?.prefetch || 10)); await ch.consume(queue, async (msg) => { if (!msg) return; try { await onMessage(normalizedEnvelope({ protocol: 'amqp091', destination: subscription.destination, payload: msg.content, headers: msg.properties.headers, messageId: msg.properties.messageId, correlationId: msg.properties.correlationId, replyTo: msg.properties.replyTo, timestamp: msg.properties.timestamp ? new Date(msg.properties.timestamp).toISOString() : undefined })); ch.ack(msg); } catch { ch.nack(msg, false, true); } }); return async () => { await ch.close(); await conn.close(); }; },
  };
}

async function kafkaAdapter(connection) {
  const { Kafka, logLevel } = await import('kafkajs');
  const raw = connection.endpoint.replace(/^kafka(?:\+ssl)?:\/\//, '');
  const kafka = new Kafka({ clientId: connection.credentials?.clientId || connection.config?.clientId || 'flolah', brokers: raw.split(',').map((x) => x.trim()), ssl: connection.endpoint.startsWith('kafka+ssl://') ? { ca: connection.credentials?.caCert ? [connection.credentials.caCert] : undefined, cert: connection.credentials?.clientCert, key: connection.credentials?.privateKey } : undefined, sasl: connection.credentials?.username ? { mechanism: connection.config?.saslMechanism || 'plain', username: connection.credentials.username, password: connection.credentials.password || '' } : undefined, logLevel: logLevel.NOTHING });
  return {
    async test() { const admin = kafka.admin(); await admin.connect(); await admin.listTopics(); await admin.disconnect(); },
    async publish(request) { const producer = kafka.producer(); await producer.connect(); const id = request.correlationId || randomUUID(); try { await producer.send({ topic: request.destination, messages: [{ key: request.key || null, value: toBuffer(request.payload), headers: { ...(request.headers || {}), 'flolah-message-id': id } }], acks: -1 }); return { messageId: id }; } finally { await producer.disconnect(); } },
    async subscribe(subscription, onMessage) { const consumer = kafka.consumer({ groupId: subscription.consumerGroup || `flolah-${subscription.id}` }); await consumer.connect(); await consumer.subscribe({ topic: subscription.destination, fromBeginning: !!subscription.options?.fromBeginning }); await consumer.run({ eachMessage: async ({ topic, partition, message }) => onMessage(normalizedEnvelope({ protocol: 'kafka', destination: topic, payload: message.value, headers: Object.fromEntries(Object.entries(message.headers || {}).map(([k, v]) => [k, v?.toString()])), messageId: message.headers?.['flolah-message-id']?.toString() || `${topic}:${partition}:${message.offset}`, key: message.key?.toString(), timestamp: new Date(Number(message.timestamp)).toISOString() })) }); return async () => consumer.disconnect(); },
  };
}

async function stompAdapter(connection) {
  const stompit = await import('stompit');
  const endpoint = new URL(connection.endpoint.replace(/^stomps?:/, connection.endpoint.startsWith('stomps:') ? 'tls:' : 'tcp:'));
  const options = { host: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === 'tls:' ? 61614 : 61613)), ssl: endpoint.protocol === 'tls:', connectHeaders: { host: connection.config?.virtualHost || '/', login: connection.credentials?.username || '', passcode: connection.credentials?.password || '', 'heart-beat': '5000,5000' } };
  const connect = () => new Promise((resolve, reject) => stompit.connect(options, (err, client) => err ? reject(err) : resolve(client)));
  return {
    async test() { const client = await connect(); client.disconnect(); },
    async publish(request) { const client = await connect(); const id = request.correlationId || randomUUID(); await new Promise((resolve, reject) => { const frame = client.send({ destination: request.destination, persistent: String(request.persistent !== false), 'message-id': id, ...(request.headers || {}) }); frame.on('error', reject); frame.end(toBuffer(request.payload), resolve); }); client.disconnect(); return { messageId: id }; },
    async subscribe(subscription, onMessage) { const client = await connect(); client.subscribe({ destination: subscription.destination, ack: 'client-individual', id: subscription.id }, async (err, message) => { if (err) return; let body = ''; message.on('data', (chunk) => { body += chunk; }); message.on('end', async () => { try { await onMessage(normalizedEnvelope({ protocol: 'stomp', destination: subscription.destination, payload: body, headers: message.headers, messageId: message.headers['message-id'] })); client.ack(message); } catch { client.nack(message); } }); }); return async () => client.disconnect(); },
  };
}

async function amqp10Adapter(connection) {
  const { Connection } = await import('rhea-promise');
  const create = () => new Connection({ transport: connection.endpoint.startsWith('amqps:') ? 'tls' : 'tcp', host: new URL(connection.endpoint).hostname, port: Number(new URL(connection.endpoint).port || (connection.endpoint.startsWith('amqps:') ? 5671 : 5672)), username: connection.credentials?.username, password: connection.credentials?.password, reconnect: true });
  return {
    async test() { const conn = create(); await conn.open(); await conn.close(); },
    async publish(request) { const conn = create(); await conn.open(); try { const sender = await conn.createSender({ target: { address: request.destination } }); const id = request.correlationId || randomUUID(); await sender.send({ message_id: id, body: request.payload, application_properties: request.headers, correlation_id: request.correlationId, reply_to: request.replyTo, ttl: request.ttlMs }); await sender.close(); return { messageId: id }; } finally { await conn.close(); } },
    async subscribe(subscription, onMessage) { const conn = create(); await conn.open(); const receiver = await conn.createReceiver({ source: { address: subscription.destination }, autoaccept: false }); receiver.on('message', async ({ message, delivery }) => { try { await onMessage(normalizedEnvelope({ protocol: 'amqp10', destination: subscription.destination, payload: typeof message.body === 'string' ? message.body : JSON.stringify(message.body), headers: message.application_properties, messageId: message.message_id, correlationId: message.correlation_id, replyTo: message.reply_to })); delivery.accept(); } catch { delivery.release(); } }); return async () => { await receiver.close(); await conn.close(); }; },
  };
}

const mockBus = new Map();
function mockAdapter(connection) {
  return {
    async test() {},
    async publish(request) { const messageId = request.correlationId || randomUUID(); for (const listener of mockBus.get(request.destination) || []) await listener(normalizedEnvelope({ protocol: 'mock', destination: request.destination, payload: toBuffer(request.payload), headers: request.headers, messageId, key: request.key })); return { messageId }; },
    async subscribe(subscription, onMessage) { const list = mockBus.get(subscription.destination) || []; list.push(onMessage); mockBus.set(subscription.destination, list); return async () => mockBus.set(subscription.destination, (mockBus.get(subscription.destination) || []).filter((item) => item !== onMessage)); },
  };
}

function jmsAdapter(connection) {
  const base = String(process.env.JMS_ADAPTER_URL || 'http://jms-adapter:8091').replace(/\/$/, '');
  const token = process.env.MESSAGING_SERVICE_TOKEN || '';
  const call = async (path, body) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const out = await response.json().catch(() => ({})); if (!response.ok) throw new Error(out.error || `JMS adapter ${response.status}`); return out; };
  return { async test() { await call('/v1/test', { connection }); }, async publish(request) { return call('/v1/publish', { connection, ...request }); }, async subscribe(subscription) { await call('/v1/subscriptions', { connection, subscription }); return async () => call('/v1/unsubscribe', { subscriptionId: subscription.id }); } };
}

function isPrivateIp(address) {
  const value = String(address || '').toLowerCase();
  return value === '::1' || value === '0.0.0.0' || value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.') || value.startsWith('169.254.') || /^172\.(1[6-9]|2\d|3[01])\./.test(value) || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}
async function assertSafeEndpoint(connection) {
  if (connection.protocol === 'mock') {
    if (process.env.NODE_ENV !== 'test' && process.env.MESSAGING_ALLOW_MOCK !== '1') throw new Error('Mock messaging is disabled');
    return;
  }
  const privateAllowed = process.env.MESSAGING_ALLOW_PRIVATE_BROKERS === '1';
  const raw = String(connection.endpoint || '').replace(/^jms:/i, '').replace(/^[a-z+]+:\/\//i, '').split('/')[0];
  const hosts = connection.protocol === 'kafka' ? raw.split(',') : [raw];
  for (const part of hosts) {
    const host = part.trim().replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '');
    if (!host || /^(localhost|metadata\.google\.internal)$/i.test(host)) throw new Error('Broker endpoint host is not allowed');
    const records = await lookup(host, { all: true });
    if (!privateAllowed && records.some((record) => isPrivateIp(record.address))) throw new Error('Private broker endpoints require MESSAGING_ALLOW_PRIVATE_BROKERS=1');
  }
}

export async function createAdapter(connection) {
  await assertSafeEndpoint(connection);
  switch (connection.protocol) {
    case 'mqtt': return mqttAdapter(connection);
    case 'amqp091': return amqp091Adapter(connection);
    case 'amqp10': return amqp10Adapter(connection);
    case 'stomp': return stompAdapter(connection);
    case 'kafka': return kafkaAdapter(connection);
    case 'jms': return jmsAdapter(connection);
    case 'mock': return mockAdapter(connection);
    default: throw new Error(`Unsupported messaging protocol: ${connection.protocol}`);
  }
}
