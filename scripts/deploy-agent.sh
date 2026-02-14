#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "❌ wrangler CLI not found on PATH."
  echo "   Install dependencies with: npm install"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <agent-id>"
  echo "Example: $0 alpha"
  exit 1
fi

RAW_AGENT_ID="$1"
AGENT_ID="$(echo "$RAW_AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
AGENT_ID="${AGENT_ID#-}"
AGENT_ID="${AGENT_ID%-}"

if [[ -z "$AGENT_ID" ]]; then
  echo "❌ Agent ID resolved to empty value after sanitization."
  exit 1
fi

SERVICE_NAME="agent-identity-${AGENT_ID}"
KV_TITLE="agent_identity_clients_${AGENT_ID}"
KV_PREVIEW_TITLE="${KV_TITLE}_preview"

TOKEN_TTL_SECONDS="${TOKEN_TTL_SECONDS:-86400}"
RATE_LIMIT_WINDOW_SECONDS="${RATE_LIMIT_WINDOW_SECONDS:-60}"
RATE_LIMIT_MAX_REGISTER="${RATE_LIMIT_MAX_REGISTER:-30}"
RATE_LIMIT_MAX_TOKEN="${RATE_LIMIT_MAX_TOKEN:-60}"
RATE_LIMIT_MAX_VALIDATE="${RATE_LIMIT_MAX_VALIDATE:-120}"
RATE_LIMIT_MAX_CLIENTS="${RATE_LIMIT_MAX_CLIENTS:-60}"

tmpfile="$(mktemp /tmp/wrangler-agent-${AGENT_ID}-XXXXXX.toml)"
cleanup() {
  rm -f "$tmpfile"
}
trap cleanup EXIT

extract_id() {
  sed -n 's/.*id = "\([^"]*\)".*/\1/p' | tail -n1
}

echo "🚀 Preparing deployment for agent: ${AGENT_ID}"
echo "   Worker: ${SERVICE_NAME}"

echo "🧱 Creating KV namespace: ${KV_TITLE}"
create_out="$(wrangler kv namespace create "$KV_TITLE" 2>&1 || true)"
kv_id="$(echo "$create_out" | extract_id)"

if [[ -z "$kv_id" ]]; then
  echo "❌ Unable to create KV namespace '${KV_TITLE}'."
  echo "   Wrangler output:"
  echo "$create_out"
  echo "   Tip: if it already exists, create a new agent id or manually set KV IDs in a custom config."
  exit 1
fi

echo "🧪 Creating preview KV namespace: ${KV_PREVIEW_TITLE}"
create_preview_out="$(wrangler kv namespace create "$KV_PREVIEW_TITLE" --preview 2>&1 || true)"
kv_preview_id="$(echo "$create_preview_out" | extract_id)"

if [[ -z "$kv_preview_id" ]]; then
  echo "❌ Unable to create preview KV namespace '${KV_PREVIEW_TITLE}'."
  echo "   Wrangler output:"
  echo "$create_preview_out"
  exit 1
fi

cat > "$tmpfile" <<EOF
name = "${SERVICE_NAME}"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "CLIENTS"
id = "${kv_id}"
preview_id = "${kv_preview_id}"

[vars]
TOKEN_TTL_SECONDS = "${TOKEN_TTL_SECONDS}"
RATE_LIMIT_WINDOW_SECONDS = "${RATE_LIMIT_WINDOW_SECONDS}"
RATE_LIMIT_MAX_REGISTER = "${RATE_LIMIT_MAX_REGISTER}"
RATE_LIMIT_MAX_TOKEN = "${RATE_LIMIT_MAX_TOKEN}"
RATE_LIMIT_MAX_VALIDATE = "${RATE_LIMIT_MAX_VALIDATE}"
RATE_LIMIT_MAX_CLIENTS = "${RATE_LIMIT_MAX_CLIENTS}"

[observability]
enabled = true
EOF

read_secret_value() {
  local env_name="$1"
  local file_fallback="$2"
  local value="${!env_name:-}"
  if [[ -n "$value" ]]; then
    printf "%s" "$value"
    return 0
  fi
  if [[ -f "$file_fallback" ]]; then
    cat "$file_fallback"
    return 0
  fi
  return 1
}

echo "🔐 Setting required secrets"

if private_key_value="$(read_secret_value PRIVATE_KEY "$ROOT_DIR/private.pem")"; then
  printf "%s" "$private_key_value" | wrangler secret put PRIVATE_KEY --name "$SERVICE_NAME"
else
  echo "❌ Missing PRIVATE_KEY (env var) and fallback file '$ROOT_DIR/private.pem' not found."
  exit 1
fi

if public_key_value="$(read_secret_value PUBLIC_KEY "$ROOT_DIR/public.pem")"; then
  printf "%s" "$public_key_value" | wrangler secret put PUBLIC_KEY --name "$SERVICE_NAME"
else
  echo "❌ Missing PUBLIC_KEY (env var) and fallback file '$ROOT_DIR/public.pem' not found."
  exit 1
fi

if [[ -n "${ADMIN_API_KEY:-}" ]]; then
  printf "%s" "$ADMIN_API_KEY" | wrangler secret put ADMIN_API_KEY --name "$SERVICE_NAME"
fi

echo "📦 Deploying worker '${SERVICE_NAME}'"
wrangler deploy --config "$tmpfile"

echo
echo "✅ Per-agent deployment complete"
echo "   Agent ID:      ${AGENT_ID}"
echo "   Service name:  ${SERVICE_NAME}"
echo "   KV namespace:  ${KV_TITLE} (${kv_id})"
echo "   Preview KV:    ${KV_PREVIEW_TITLE} (${kv_preview_id})"
