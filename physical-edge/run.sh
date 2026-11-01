#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
node ../check-node.mjs
[ -d node_modules ] || npm ci
[ -d ../backend/node_modules ] || npm --prefix ../backend ci
case "${1:-lab}" in
 lab) exec npm run lab ;;
 gateway) [ "$#" -eq 2 ] || { echo 'Usage: sh run.sh gateway /absolute/path/gateway.json' >&2; exit 1; }; exec npm start -- "$2" ;;
 *) echo 'Use lab or gateway <config>' >&2; exit 1 ;;
esac
