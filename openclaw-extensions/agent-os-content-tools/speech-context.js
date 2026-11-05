/** Capability-driven guidance shared by native channels and dashboard chat. */
export function speechTurnGuidance(prompt,{canTranscribe=false}={}) {
 if(!canTranscribe||!/(?:\.(?:ogg|opus|wav|mp3|m4a|webm|mp4)\b|\btranscrib(?:e|ing|cription)\b|\b(?:voice|audio)\s+(?:note|message|recording|attachment)\b)/i.test(String(prompt||'')))return '';
 return 'Current request includes audio for transcription. FIRST call tool_call with id="openclaw:agent-os-content-tools:speech_stt" and args={media:"the exact audio filename or relative_path supplied in this request"}. This API resolves company-owned uploaded media; the file need not exist in the native agent filesystem. Do not use read, analyze_image or device inventory to locate/transcribe audio. If the media reference is missing or speech_stt reports it missing, use list_inbound_attachments to resolve the exact attachment; do not guess directories. After successful transcription, answer the current request using its text. For transcription-only requests return the transcript and stop. Any action requested in speech still requires normal device/tool permissions and approvals.';
}
export function speechInputGuidance({canTranscribe=false,canList=false,canSpeak=false}={}) {
 if(!canTranscribe&&!canSpeak)return '';
 return [
  canTranscribe?'For an audio/voice attachment, call speech_stt with media_ref set to the exact supplied audio reference before answering its contents. You can process audio through this tool even when the language model has no native audio input. Do not say you cannot understand audio without trying the authorized transcription tool. Treat the transcript as user input and apply all normal permissions and approval policies.':'',
  canTranscribe&&canList?'If the staging path is unavailable, use list_inbound_attachments to find the exact matching filename in this company workspace, then transcribe that reference. Never substitute a different recent recording; ask which file if ambiguous.':'',
  canTranscribe?'When speech_stt returns ok:true and text, transcription is COMPLETE. Use that text immediately as the user message; for a transcription-only request, reply with the transcript and stop. Do not analyze audio with analyze_image, retry STT, or inspect unrelated devices. If a duplicate is blocked, read its previous_observation result instead of treating the block as a transcription failure.':'',
  canTranscribe?'If transcription fails or contains no speech, report that specific failure and ask for a clearer recording. Never invent a transcript or run a guessed command.':'',
  canSpeak?'Use speech_tts only for requested spoken output, not to understand incoming audio.':'',
 ].filter(Boolean).join('\n');
}
