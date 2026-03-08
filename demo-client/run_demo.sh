#!/usr/bin/env sh
set -eu

MODE="${1:-prod}"          # sandbox | deny | prod
SERVICE="${2:-payments-api}"
ENVIRONMENT="${3:-production}"
COMMIT="${4:-abc1234}"

GATEWAY_BASE="http://localhost:7000"
POLICY_BASE="http://localhost:5000"

say() {
  printf '\n== %s ==\n' "$1"
}

show_json() {
  printf '%s\n' "$1" | python3 -m json.tool
}

json_get() {
  KEY="$1"
  python3 -c "import sys, json; data=json.load(sys.stdin); print(data$KEY)"
}

say "VFA Cloud PoC demo"
echo "MODE=$MODE"
echo "SERVICE=$SERVICE"
echo "ENVIRONMENT=$ENVIRONMENT"
echo "COMMIT=$COMMIT"

case "$MODE" in
  sandbox)
    say "1. Direct deploy request without VFA session -> expect SANDBOX routing"
    RESP=$(curl -s -X POST "$GATEWAY_BASE/deploy" \
      -H "Content-Type: application/json" \
      -d "{
        \"service\":\"${SERVICE}\",
        \"env\":\"${ENVIRONMENT}\",
        \"commit\":\"${COMMIT}\",
        \"requestedBy\":\"demo-client\"
      }")
    show_json "$RESP"
    DECISION=$(printf '%s' "$RESP" | json_get '["gatewayDecision"]')
    say "Result"
    echo "Gateway decision: $DECISION"
    exit 0
    ;;
  deny|prod)
    ;;
  *)
    echo "Unknown MODE: $MODE"
    echo "Use one of: sandbox | deny | prod"
    exit 1
    ;;
esac

say "1. VFA presence / connect request through gateway"
CONNECT_RESP=$(curl -s -X POST "$GATEWAY_BASE/connect/request" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId":"demo-client",
    "target":"deploy-target",
    "vfa":true,
    "version":"0.1",
    "mode":"required"
  }')
show_json "$CONNECT_RESP"

SESSION_ID=$(printf '%s' "$CONNECT_RESP" | json_get '["sessionId"]')
VFA_ACCEPTED=$(printf '%s' "$CONNECT_RESP" | python3 -c 'import sys, json; print(str(json.load(sys.stdin)["vfaAccepted"]).lower())')

echo "SESSION_ID=$SESSION_ID"
echo "VFA_ACCEPTED=$VFA_ACCEPTED"

if [ "$VFA_ACCEPTED" != "true" ]; then
  echo "VFA negotiation failed."
  exit 1
fi

if [ "$MODE" = "deny" ]; then
  say "2. Call gateway with VFA session but WITHOUT visa -> expect DENY"
  RESP=$(curl -s -X POST "$GATEWAY_BASE/deploy" \
    -H "Content-Type: application/json" \
    -d "{
      \"sessionId\":\"${SESSION_ID}\",
      \"service\":\"${SERVICE}\",
      \"env\":\"${ENVIRONMENT}\",
      \"commit\":\"${COMMIT}\",
      \"requestedBy\":\"demo-client\"
    }")
  show_json "$RESP"
  DECISION=$(printf '%s' "$RESP" | json_get '["gatewayDecision"]')
  REASON=$(printf '%s' "$RESP" | json_get '["reason"]')
  say "Result"
  echo "Gateway decision: $DECISION"
  echo "Reason: $REASON"
  exit 0
fi

say "2. Intent request"
INTENT_RESP=$(curl -s -X POST "$POLICY_BASE/intent/request" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":\"${SESSION_ID}\",
    \"intent\":\"deploy\",
    \"service\":\"${SERVICE}\",
    \"env\":\"${ENVIRONMENT}\",
    \"commit\":\"${COMMIT}\",
    \"requestedBy\":\"demo-client\"
  }")
show_json "$INTENT_RESP"

INTENT_ID=$(printf '%s' "$INTENT_RESP" | json_get '["intentId"]')
WALLET_URL=$(printf '%s' "$INTENT_RESP" | json_get '["walletUrl"]')

echo "INTENT_ID=$INTENT_ID"

say "3. Wallet approval required"
echo "Open this URL in your browser:"
echo "$WALLET_URL"
printf '\nAfter approval press Enter... '
read dummy

say "4. Fetch visa token"
TOKEN_RESP=$(curl -s "$POLICY_BASE/intent/${INTENT_ID}/token")
show_json "$TOKEN_RESP"
TOKEN=$(printf '%s' "$TOKEN_RESP" | json_get '["token"]')

say "5. Call protected deploy through gateway -> expect PRODUCTION routing"
DEPLOY_RESP=$(curl -s -X POST "$GATEWAY_BASE/deploy" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":\"${SESSION_ID}\",
    \"token\":\"${TOKEN}\",
    \"service\":\"${SERVICE}\",
    \"env\":\"${ENVIRONMENT}\",
    \"commit\":\"${COMMIT}\",
    \"requestedBy\":\"demo-client\"
  }")
show_json "$DEPLOY_RESP"

DECISION=$(printf '%s' "$DEPLOY_RESP" | json_get '["gatewayDecision"]')
REASON=$(printf '%s' "$DEPLOY_RESP" | json_get '["reason"]')

say "Result"
echo "Gateway decision: $DECISION"
echo "Reason: $REASON"