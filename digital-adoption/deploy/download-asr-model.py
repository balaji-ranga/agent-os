"""Build-time public model download. Runtime transcription is offline."""
import sys
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id='Systran/faster-whisper-tiny.en',
    revision='0d3d19a32d3338f10357c0889762bd8d64bbdeba',
    local_dir=sys.argv[1],
    allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*'],
    token=False,
)
