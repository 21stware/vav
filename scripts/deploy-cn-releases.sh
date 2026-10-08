#!/usr/bin/env bash
# Mirror a GitHub Release onto vavapp.art/releases for the CN generic updater feed.
# Does not replace the international GitHub feed. Requires `gh` + `ssh vav`.
#
#   bash scripts/deploy-cn-releases.sh            # latest tag on this repo
#   bash scripts/deploy-cn-releases.sh v1.32.8
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VAV_CN_SSH:-vav}"
DEST="${VAV_CN_RELEASES:-/var/www/vavapp/releases}"
REPO="${VAV_UPDATE_REPO:-21stware/vav}"
TAG="${1:-}"

if [ -z "$TAG" ]; then
  TAG="$(cd "$ROOT" && git describe --tags --abbrev=0)"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/vav-releases-cn.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

gh release download "$TAG" --repo "$REPO" --dir "$STAGE" \
  --pattern 'latest*.yml' \
  --pattern 'VAV-*-macos-arm64.zip' \
  --pattern 'VAV-*-macos-arm64.zip.blockmap' \
  --pattern 'VAV-*-macos-arm64.dmg' \
  --pattern 'VAV-*-windows-x64-setup.exe' \
  --pattern 'VAV-*-windows-x64-setup.exe.blockmap'

ssh "$HOST" "sudo mkdir -p '$DEST' && sudo chown \"\$(whoami)\" '$DEST'"
rsync -az --delete "$STAGE/" "$HOST:$DEST/"
echo "published $HOST:$DEST ($TAG)"
