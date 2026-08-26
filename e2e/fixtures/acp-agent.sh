#!/bin/bash
exec /usr/bin/env node "$(cd "$(dirname "$0")" && pwd)/acp-agent.mjs" "$@"
