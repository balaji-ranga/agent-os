#!/bin/bash
set -euo pipefail
echo "=== ollama container ==="
docker ps -a --format '{{.Names}} {{.Status}}' | grep -i ollama || echo 'NO_OLLAMA_CONTAINER'
echo "=== models on disk ==="
docker exec agent-os-backend-1 node -e 'fetch("http://ollama:11434/api/tags").then(r=>r.json()).then(j=>console.log(((j.models||[]).map(m=>m.name).join("\n"))||"(none)")).catch(e=>console.log("ERR",e.message))'
echo "=== models loaded in RAM (api/ps) ==="
docker exec agent-os-backend-1 node -e 'fetch("http://ollama:11434/api/ps").then(r=>r.json()).then(j=>{const m=j.models||[]; if(!m.length) console.log("(none loaded)"); else for (const x of m) console.log((x.name||x.model), "size="+String(x.size||x.size_vram||"?"));}).catch(e=>console.log("ERR",e.message))'
echo "=== memory ==="
free -h | head -2
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep -Ei 'ollama|openclaw|backend' || true
