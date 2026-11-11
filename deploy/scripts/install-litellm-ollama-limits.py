"""Preserve Ollama's top-level truncate switch through its LiteLLM adapter."""
from pathlib import Path
import sys,ast
p=Path(sys.argv[1]);s=p.read_text()
if '# FLOLAH_OLLAMA_TRUNCATE_V1' not in s:
 old='        think: Final = optional_params.pop("think", None)'
 assert s.count(old)==1,'Installed Ollama adapter ABI changed'
 s=s.replace(old,old+'\n        truncate = optional_params.pop("truncate", None) # FLOLAH_OLLAMA_TRUNCATE_V1')
 old='        if think is not None:\n            data["think"] = think'
 assert s.count(old)==1,'Installed Ollama adapter ABI changed'
 s=s.replace(old,old+'\n        if truncate is not None:\n            data["truncate"] = truncate')
 ast.parse(s);p.write_text(s)
print('Ollama truncation limit preserved')
