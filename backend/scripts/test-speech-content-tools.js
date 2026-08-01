/**
 * E2E: speech_tts (Piper) -> speech_stt (Whisper) via content-tool handlers.
 * Run inside backend container:
 *   node scripts/test-speech-content-tools.js
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const backendRoot = join(__dirname, "..");

const { getDb } = require(join(backendRoot, "src/db/schema.js"));
const { executeSpeechTtsTool, executeSpeechSttTool } = await import(
  join(backendRoot, "src/services/speech-content-tools.js")
);

const owner =
  process.env.TEST_SPEECH_OWNER_USER_ID ||
  getDb().prepare("SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY id LIMIT 1").get()?.id;

if (!owner) {
  console.error("[speech-tools] no CEO owner");
  process.exit(1);
}
if (!process.env.SPEECH_STT_URL || !process.env.SPEECH_TTS_URL) {
  console.error("[speech-tools] SPEECH_STT_URL and SPEECH_TTS_URL required");
  process.exit(1);
}

const phrase = "Agent OS speech tools test. Piper speaks and Whisper listens back.";
console.log("[speech-tools] owner=", owner);
console.log("[speech-tools] STT=", process.env.SPEECH_STT_URL);
console.log("[speech-tools] TTS=", process.env.SPEECH_TTS_URL);

const tts = await executeSpeechTtsTool({ text: phrase, speak_clean: false }, owner);
const artifactId = tts?.audio?.artifactId || tts?.audio?.artifact_id || tts?.audio?.id;
if (!tts?.ok || !artifactId) {
  console.error("[speech-tools] TTS failed", tts);
  process.exit(1);
}
console.log("[speech-tools] TTS ok artifact=", artifactId, "url=", tts.url);

const stt = await executeSpeechSttTool({ artifact_id: artifactId, language: "en" }, owner);
if (!stt?.ok || !String(stt.text || "").trim()) {
  console.error("[speech-tools] STT failed", stt);
  process.exit(1);
}
const transcript = String(stt.text || "").toLowerCase();
const hits = ["agent", "speech", "whisper", "piper", "test", "listen"].filter((w) => transcript.includes(w));
console.log("[speech-tools] STT text=", stt.text);
if (hits.length < 1) {
  console.error("[speech-tools] transcript too weak", { transcript, hits });
  process.exit(1);
}
console.log("SPEECH_CONTENT_TOOLS_OK", { owner, artifactId, hits });