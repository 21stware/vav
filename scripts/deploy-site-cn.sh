#!/usr/bin/env bash
# Publish site/ to the mainland box (ssh vav → vavapp.art).
# Stamps data-site-region=cn so the ICP footer is visible without JavaScript.
# Does not touch vavapp.com / GitHub Pages / Cloudflare, or the DERP units.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VAV_CN_SSH:-vav}"
DEST="${VAV_CN_DEST:-/var/www/vavapp}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/vav-site-cn.XXXXXX")"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

rsync -a --delete --exclude CNAME --exclude releases "$ROOT/site/" "$STAGE/"

python3 - "$STAGE/index.html" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = "<html lang=\"en\">"
new = "<html lang=\"zh-CN\" data-site-region=\"cn\">"
if old not in text:
    raise SystemExit("site/index.html: expected <html lang=\"en\"> to stamp CN region")
path.write_text(text.replace(old, new, 1))
PY

ssh "$HOST" "sudo mkdir -p '$DEST' && sudo chown \"\$(whoami)\" '$DEST'"
# Keep /releases (CN updater feed) — site tree must not wipe it.
rsync -az --delete --exclude releases/ "$STAGE/" "$HOST:$DEST/"
echo "published $HOST:$DEST"
