#!/bin/sh
set -eu
root=${1:?explicit adoption root required}
helper=${2:?explicit retention helper required}
image=${3:?explicit pinned runtime image required}
test -d "$root/data/checkpoints"
test -d "$root/backups"
test -f "$root/config/retention.json"
test -f "$helper"
# The ephemeral job sees only the two checkpoint directories and its read-only
# policy/helper. It has no network, application database, object store or secrets.
docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --memory 96m --pids-limit 32 \
  --mount "type=bind,source=$root/data/checkpoints,target=/checkpoints" \
  --mount "type=bind,source=$root/backups,target=/backups" \
  --mount "type=bind,source=$root/config/retention.json,target=/policy.json,readonly" \
  --mount "type=bind,source=$helper,target=/retention.mjs,readonly" \
  --entrypoint node "$image" /retention.mjs /policy.json /checkpoints /backups --apply
