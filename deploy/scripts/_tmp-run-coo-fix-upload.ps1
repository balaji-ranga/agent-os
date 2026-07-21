# Upload plugin + backend fixes and run deploy script on VPS.
$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".ssh\agent-os-vps"
$root = "c:\Users\balaj\projects\agents\agent-os"
$scp = @("-i", $key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes")
$host_ = "root@76.13.209.30"

Write-Host "Uploading files..."
& scp @scp `
  "$root\openclaw-extensions\agent-os-content-tools\index.js" `
  "${host_}:/tmp/agent-os-content-tools-index.js"
& scp @scp `
  "$root\openclaw-extensions\agent-os-content-tools\openclaw.plugin.json" `
  "${host_}:/tmp/agent-os-content-tools-plugin.json"
& scp @scp `
  "$root\backend\src\routes\tools.js" `
  "${host_}:/tmp/backend-tools.js"
& scp @scp `
  "$root\backend\src\services\content-tools-meta.js" `
  "${host_}:/tmp/backend-content-tools-meta.js"
& scp @scp `
  "$root\deploy\scripts\_tmp-deploy-coo-workflow-fix.sh" `
  "${host_}:/tmp/deploy-coo-workflow-fix.sh"

Write-Host "Running deploy..."
& ssh @scp $host_ "bash /tmp/deploy-coo-workflow-fix.sh"
