package cloud.flolah.jms;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.jms.*;
import org.apache.activemq.artemis.jms.client.ActiveMQConnectionFactory;
import org.apache.qpid.jms.JmsConnectionFactory;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

public final class Main {
  static final ObjectMapper JSON = new ObjectMapper();
  static final String TOKEN = System.getenv().getOrDefault("MESSAGING_SERVICE_TOKEN", "");
  static final String BACKEND = System.getenv().getOrDefault("BACKEND_INTERNAL_URL", "http://backend:3001/api/internal/messaging");
  static final Map<String, AutoCloseable> ACTIVE = new ConcurrentHashMap<>();
  static final HttpClient HTTP = HttpClient.newHttpClient();

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress(Integer.parseInt(System.getenv().getOrDefault("PORT", "8091"))), 0);
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    server.createContext("/health", ex -> reply(ex, 200, Map.of("ok", true, "activeSubscriptions", ACTIVE.size())));
    server.createContext("/v1/test", ex -> secured(ex, body -> { try (JMSContext context = factory(connection(body)).createContext()) { context.start(); } return Map.of("ok", true); }));
    server.createContext("/v1/publish", ex -> secured(ex, Main::publish));
    server.createContext("/v1/subscriptions", ex -> secured(ex, Main::subscribe));
    server.createContext("/v1/unsubscribe", ex -> secured(ex, body -> { AutoCloseable item = ACTIVE.remove(text(body.get("subscriptionId"))); if (item != null) item.close(); return Map.of("ok", true); }));
    server.start();
    System.out.println("[jms-adapter] listening on " + server.getAddress().getPort());
  }

  interface Action { Object run(Map<String,Object> body) throws Exception; }
  static void secured(HttpExchange ex, Action action) throws IOException {
    if (TOKEN.isBlank() || !Objects.equals(ex.getRequestHeaders().getFirst("Authorization"), "Bearer " + TOKEN)) { reply(ex, 401, Map.of("ok", false, "error", "Unauthorized")); return; }
    try { Map<String,Object> body = JSON.readValue(ex.getRequestBody(), new TypeReference<>() {}); reply(ex, 200, action.run(body)); }
    catch (Exception error) { reply(ex, 502, Map.of("ok", false, "error", String.valueOf(error.getMessage()))); }
  }
  @SuppressWarnings("unchecked") static Map<String,Object> connection(Map<String,Object> body) { return (Map<String,Object>) body.get("connection"); }
  @SuppressWarnings("unchecked") static ConnectionFactory factory(Map<String,Object> connection) {
    String endpoint = String.valueOf(connection.get("endpoint")).replaceFirst("^jms:", "");
    Map<String,Object> config = (Map<String,Object>) connection.getOrDefault("config", Map.of());
    Map<String,Object> credentials = (Map<String,Object>) connection.getOrDefault("credentials", Map.of());
    String provider = String.valueOf(config.getOrDefault("provider", endpoint.startsWith("amqp") ? "qpid" : "artemis"));
    String user = text(credentials.get("username")); String password = text(credentials.get("password"));
    return provider.equalsIgnoreCase("qpid") ? new JmsConnectionFactory(user, password, endpoint) : new ActiveMQConnectionFactory(endpoint, user, password);
  }
  static Destination destination(JMSContext context, Map<String,Object> body) { String name = text(body.get("destination")); return "topic".equalsIgnoreCase(text(body.get("destinationType"))) ? context.createTopic(name) : context.createQueue(name); }
  @SuppressWarnings("unchecked") static Object publish(Map<String,Object> body) {
    try (JMSContext context = factory(connection(body)).createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
      JMSProducer producer = context.createProducer();
      String id = !text(body.get("correlationId")).isBlank() ? text(body.get("correlationId")) : UUID.randomUUID().toString();
      producer.setJMSCorrelationID(id);
      if (!text(body.get("replyTo")).isBlank()) producer.setJMSReplyTo(context.createQueue(text(body.get("replyTo"))));
      if (body.get("ttlMs") instanceof Number ttl) producer.setTimeToLive(ttl.longValue());
      ((Map<String,Object>) body.getOrDefault("headers", Map.of())).forEach((k,v) -> producer.setProperty(k, String.valueOf(v)));
      Object payload = body.get("payload"); producer.send(destination(context, body), payload instanceof String ? (String) payload : json(payload));
      return Map.of("ok", true, "messageId", id);
    }
  }
  @SuppressWarnings("unchecked") static Object subscribe(Map<String,Object> body) throws Exception {
    Map<String,Object> subscription = (Map<String,Object>) body.get("subscription"); String id = text(subscription.get("id"));
    AutoCloseable old = ACTIVE.remove(id); if (old != null) old.close();
    JMSContext context = factory(connection(body)).createContext(JMSContext.CLIENT_ACKNOWLEDGE);
    JMSConsumer consumer = context.createConsumer(destination(context, subscription));
    consumer.setMessageListener(message -> {
      try {
        Map<String,Object> headers = new LinkedHashMap<>(); Enumeration<?> names = message.getPropertyNames(); while (names.hasMoreElements()) { String name = String.valueOf(names.nextElement()); headers.put(name, message.getObjectProperty(name)); }
        Object payload = message instanceof TextMessage text ? text.getText() : message instanceof BytesMessage bytes ? readBytes(bytes) : String.valueOf(message.getBody(Object.class));
        Map<String,Object> envelope = new LinkedHashMap<>(); envelope.put("protocol", "jms"); envelope.put("destination", subscription.get("destination")); envelope.put("payload", payload); envelope.put("headers", headers); envelope.put("messageId", Optional.ofNullable(message.getJMSMessageID()).orElse(UUID.randomUUID().toString())); envelope.put("correlationId", message.getJMSCorrelationID()); envelope.put("timestamp", Instant.ofEpochMilli(message.getJMSTimestamp()).toString());
        postBackend(Map.of("subscriptionId", id, "envelope", envelope)); message.acknowledge();
      } catch (Exception error) { System.err.println("[jms-adapter] delivery failed " + id + ": " + error.getMessage()); }
    });
    context.start(); ACTIVE.put(id, () -> { consumer.close(); context.close(); }); return Map.of("ok", true, "subscriptionId", id);
  }
  static byte[] readBytes(BytesMessage message) throws JMSException { byte[] data = new byte[(int) message.getBodyLength()]; message.readBytes(data); return data; }
  static void postBackend(Object body) throws Exception { HttpRequest request = HttpRequest.newBuilder(URI.create(BACKEND + "/deliver")).header("Authorization", "Bearer " + TOKEN).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json(body))).build(); HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString()); if (response.statusCode() / 100 != 2) throw new IOException("Backend " + response.statusCode() + ": " + response.body()); }
  static String text(Object value) { return value == null ? "" : String.valueOf(value); }
  static String json(Object value) { try { return JSON.writeValueAsString(value); } catch (Exception e) { throw new RuntimeException(e); } }
  static void reply(HttpExchange ex, int status, Object value) throws IOException { byte[] data = json(value).getBytes(StandardCharsets.UTF_8); ex.getResponseHeaders().set("Content-Type", "application/json"); ex.getResponseHeaders().set("Cache-Control", "no-store"); ex.sendResponseHeaders(status, data.length); ex.getResponseBody().write(data); ex.close(); }
}
