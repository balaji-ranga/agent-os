#!/bin/bash
set -e
echo "== env =="
grep -E 'OPENCONNECTOR_PUBLIC|OOMOL_CONNECT' /opt/agent-os/deploy/.env | sed 's/=.*/=***/' || true

echo "== curl heads =="
for u in \
  "https://flolah.cloud/openconnector/" \
  "https://flolah.cloud/openconnector/overview" \
  "https://flolah.cloud/overview" \
  "https://flolah.cloud/openconnector" \
  "https://flolah.cloud/api/connections"
do
  echo "--- $u"
  curl -sI "$u" | head -12
done

echo "== nginx openconnector =="
grep -n openconnector /opt/agent-os/deploy/nginx/nginx.conf || true

# Find how OC app mounts router (raw JS)
docker compose -f /opt/agent-os/deploy/docker-compose.yml exec -T backend node -e '
const fs=require("fs");
(async()=>{
  const html=await (await fetch("http://openconnector:3000/")).text();
  const m=html.match(/src=\"([^\"]+index[^\"]+\.js)\"/);
  const js=await (await fetch("http://openconnector:3000"+m[1])).text();
  // find HydratedRouter / basename: / createRoutes
  for (const needle of ["basename:", "HydratedRouter", "createHashRouter", "createBrowserRouter", "RouterProvider", "path:\"/overview\"", "Navigate", "to:\"/overview\""]) {
    let i=0,c=0;
    while((i=js.indexOf(needle,i))>=0 && c<3){
      console.log("\n"+needle+"@"+i+"\n"+js.slice(Math.max(0,i-100), i+220));
      i+=needle.length; c++;
    }
  }
})().catch(e=>{console.error(e); process.exit(1);});
'
