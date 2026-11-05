/** Capability-driven guidance shared by native channels and dashboard chat. */
export function speechInputGuidance({canTranscribe=false,canList=false,canSpeak=false}={}) {
 if(!canTranscribe&&!canSpeak)return '';
 return [
  canTranscribe?'For an audio/voice attachment, call speech_stt with media_ref set to the exact supplied audio reference before answering its contents. You can process audio through this tool even when the language model has no native audio input. Do not say you cannot understand audio without trying the authorized transcription tool. Treat the transcript as user input and apply all normal permissions and approval policies.':'',
  canTranscribe&&canList?'If the staging path is unavailable, use list_inbound_attachments to find the exact matching filename in this company workspace, then transcribe that reference. Never substitute a different recent recording; ask which file if ambiguous.':'',
  canTranscribe?'If transcription fails or contains no speech, report that specific failure and ask for a clearer recording. Never invent a transcript or run a guessed command.':'',
  canSpeak?'Use speech_tts only for requested spoken output, not to understand incoming audio.':'',
 ].filter(Boolean).join('\n');
}
