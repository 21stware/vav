#!/usr/bin/env bash
# Apply mainland DERP + Caddy units on the Tencent Lighthouse box (ssh vav).
# Requires DNS: derp.vavapp.art A → the box (same IP as vavapp.art).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VAV_CN_SSH:-vav}"
SRC="$ROOT/deploy/cn"

ssh "$HOST" 'sudo mkdir -p /etc/caddy /etc/systemd/system'
scp -q "$SRC/Caddyfile" "$HOST:/tmp/vav-Caddyfile"
scp -q "$SRC/derper.service" "$HOST:/tmp/vav-derper.service"
scp -q "$SRC/vav-cn-firewall.service" "$HOST:/tmp/vav-cn-firewall.service"
ssh "$HOST" 'set -euo pipefail
  sudo install -m 644 /tmp/vav-Caddyfile /etc/caddy/Caddyfile
  sudo install -m 644 /tmp/vav-derper.service /etc/systemd/system/derper.service
  sudo install -m 644 /tmp/vav-cn-firewall.service /etc/systemd/system/vav-cn-firewall.service
  rm -f /tmp/vav-Caddyfile /tmp/vav-derper.service /tmp/vav-cn-firewall.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now vav-cn-firewall.service derper.service caddy.service
  sudo systemctl restart derper.service
  sudo systemctl reload caddy.service
'
echo "applied relay units on $HOST"
