#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://ruby.gihc.online}"
BASE_URL="${BASE_URL%/}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

echo "==> Tester ${BASE_URL}"
curl -fsS --max-time 30 "${BASE_URL}/" -o "${TMP_DIR}/index.html"
curl -fsS --max-time 30 "${BASE_URL}/healthz" | grep -qx 'ok' \
    || fail "health endpoint svarer ikke ok"
grep -q '<title>Ruby i browseren</title>' "${TMP_DIR}/index.html" \
    || fail "forsidens titel mangler"
grep -q 'src="/assets/' "${TMP_DIR}/index.html" \
    || fail "det hashede frontend-asset refereres ikke"

STATUS="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "${BASE_URL}/not-here")"
[ "$STATUS" = "404" ] || fail "ukendt sti giver HTTP ${STATUS}, forventet 404"

curl -fsS --max-time 30 -D "${TMP_DIR}/headers.txt" \
    -o /dev/null "${BASE_URL}/"
grep -qi '^cross-origin-opener-policy: same-origin' "${TMP_DIR}/headers.txt" \
    || fail "Cross-Origin-Opener-Policy mangler"
grep -qi '^cross-origin-embedder-policy: require-corp' "${TMP_DIR}/headers.txt" \
    || fail "Cross-Origin-Embedder-Policy mangler"
grep -qi '^content-security-policy:' "${TMP_DIR}/headers.txt" \
    || fail "Content-Security-Policy mangler"
grep -qi "wasm-unsafe-eval" "${TMP_DIR}/headers.txt" \
    || fail "CSP tillader ikke WebAssembly"
grep -qi '^x-content-type-options: nosniff' "${TMP_DIR}/headers.txt" \
    || fail "X-Content-Type-Options mangler"

if [[ "$BASE_URL" == https://* ]]; then
    VERIFY_RESULT="$(curl -fsS --max-time 30 -o /dev/null \
        -w '%{ssl_verify_result}' "${BASE_URL}/")"
    [ "$VERIFY_RESULT" = "0" ] || fail "TLS-certifikatet kunne ikke verificeres"
fi

echo "PASS: side, health, 404, WASM-headere og TLS er OK"
