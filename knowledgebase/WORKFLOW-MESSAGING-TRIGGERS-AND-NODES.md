# Workflow messaging triggers and Send Message

Flolah workflows can start from broker messages and publish messages without changing the existing workflow runner contract.

## Supported transports

- Kafka
- MQTT 3.1.1 / 5
- AMQP 0.9.1
- AMQP 1.0
- STOMP
- JMS / Jakarta Messaging through the isolated Java adapter (Qpid JMS or ActiveMQ Artemis)

## Security and tenancy

Messaging connections are owned by the CEO account. Workflow publish validation rejects a connection belonging to another owner. Connection records contain endpoint and non-secret protocol options only. Usernames, passwords, tokens and TLS material are selected by API Keys Vault name and resolved in memory immediately before connecting.

The broker workers are internal Docker services and have no public ports. They call the backend using `MESSAGING_SERVICE_TOKEN`; the backend performs workflow/owner lookup and idempotency before starting a run. Never put credentials in a broker URL or protocol-options JSON.

## Configure

1. Add broker secrets or certificates under **Settings → API Keys**.
2. Open **Connectors → Messaging & IoT**.
3. Create a connection, choose the Vault entries, and use **Test**.
4. In Workflow Builder, enable **message** on the Trigger and select the connection/destination; or add a **Send Message** node.
5. Publish the workflow. The listener reconciles new, paused and changed definitions automatically.

Every inbound envelope provides `protocol`, `destination`, `payload`, `headers`, `messageId`, `key`, `correlationId`, `replyTo` and `timestamp`. Broker message IDs are deduplicated per tenant, connection and subscription. A message is acknowledged only after the backend accepts a durable workflow run; transient delivery failures are requeued where the protocol supports it.

## Operations and rollback

`messaging-listener` owns the Node protocol clients. `jms-adapter` owns Java/Jakarta JMS clients. Both are resource-isolated from `backend`, and the existing manual/chat/schedule/event runners remain unchanged. Health endpoints are internal at ports 8090 and 8091.

The pre-change rollback reference is `checkpoint/workflow-messaging-20260925`.
