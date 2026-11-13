#!/usr/bin/env bash
set -euo pipefail

# Opretter A-record for ruby.gihc.online hos Simply.com.
# Credentials hentes fra pass som simply/account og simply/api-key.

DOMAIN="gihc.online"
RECORD_NAME="${RECORD_NAME:-ruby}"
VPS_IP="${VPS_IP:-65.109.233.92}"

SIMPLY_ACCOUNT="$(pass simply/account)"
SIMPLY_API_KEY="$(pass simply/api-key)"
API_URL="https://api.simply.com/2/my/products/${DOMAIN}/dns/records/"

echo "==> Henter DNS-records for ${DOMAIN}"
RECORDS="$(curl -fsS -u "${SIMPLY_ACCOUNT}:${SIMPLY_API_KEY}" "${API_URL}")"

EXISTING="$(RECORD_NAME="$RECORD_NAME" python3 -c '
import json, os, sys
records = json.load(sys.stdin).get("records", [])
name = os.environ["RECORD_NAME"]
matches = [r.get("data", "") for r in records if r.get("type") == "A" and r.get("name") == name]
print(",".join(matches))
' <<<"$RECORDS")"

if [ -n "$EXISTING" ]; then
    if [ "$EXISTING" = "$VPS_IP" ]; then
        echo "==> A-record ${RECORD_NAME}.${DOMAIN} peger allerede på ${VPS_IP}"
    else
        echo "==> A-record ${RECORD_NAME}.${DOMAIN} peger på ${EXISTING}, ikke ${VPS_IP}" >&2
        exit 1
    fi
    exit 0
fi

echo "==> Opretter A-record ${RECORD_NAME}.${DOMAIN} -> ${VPS_IP}"
curl -fsS -u "${SIMPLY_ACCOUNT}:${SIMPLY_API_KEY}" \
    -X POST "${API_URL}" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"${RECORD_NAME}\",\"data\":\"${VPS_IP}\",\"ttl\":3600}" \
    -o /dev/null

echo "==> Oprettet"
