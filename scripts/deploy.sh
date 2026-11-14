#!/usr/bin/env bash
set -euo pipefail

# Deployer den statiske Ruby-editor til k3s.
#
# k3s API'et er ikke offentligt tilgængeligt. Åbn SSH-tunnelen først:
#   ssh -L 16443:localhost:6443 -N -f hetzner-k3s
#   KUBECTL_SERVER=https://127.0.0.1:16443 ./scripts/deploy.sh
#
# Brug et SHA-tag for reproducerbar deployment og rollback:
#   IMAGE=ghcr.io/gihc-org/ruby:<commit-sha> ./scripts/deploy.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/gihc.yml}"
NAMESPACE="ruby"
DEPLOYMENT="ruby"
IMAGE="${IMAGE:-}"

KUBECTL=(kubectl)
if [ -n "${KUBECTL_SERVER:-}" ]; then
    KUBECTL+=(--server="$KUBECTL_SERVER")
fi

echo "==> Anvender Kubernetes-manifester"
"${KUBECTL[@]}" apply -f "${ROOT_DIR}/k8s/namespace.yaml"
"${KUBECTL[@]}" apply -f "${ROOT_DIR}/k8s/deployment.yaml"
"${KUBECTL[@]}" apply -f "${ROOT_DIR}/k8s/service.yaml"
"${KUBECTL[@]}" apply -f "${ROOT_DIR}/k8s/ingress.yaml"
"${KUBECTL[@]}" apply -f "${ROOT_DIR}/k8s/network-policy.yaml"

if [ -n "$IMAGE" ]; then
    echo "==> Bruger image ${IMAGE}"
    "${KUBECTL[@]}" -n "$NAMESPACE" set image "deployment/${DEPLOYMENT}" "web=${IMAGE}"
    "${KUBECTL[@]}" -n "$NAMESPACE" patch "deployment/${DEPLOYMENT}" \
        --type=json \
        -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
fi

"${KUBECTL[@]}" -n "$NAMESPACE" annotate "deployment/${DEPLOYMENT}" \
    "kubernetes.io/change-cause=Deploy ${IMAGE:-manifest image}" --overwrite
"${KUBECTL[@]}" -n "$NAMESPACE" rollout restart "deployment/${DEPLOYMENT}"
"${KUBECTL[@]}" -n "$NAMESPACE" rollout status "deployment/${DEPLOYMENT}" --timeout=180s

echo "==> Venter på TLS-certifikatet"
for _ in $(seq 1 36); do
    READY="$("${KUBECTL[@]}" -n "$NAMESPACE" get certificate ruby-gihc-online-tls \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
    if [ "$READY" = "True" ]; then
        break
    fi
    sleep 5
done

if [ "${READY:-}" != "True" ]; then
    echo "Certifikatet er ikke klart. Se:" >&2
    echo "  kubectl -n ${NAMESPACE} describe certificate ruby-gihc-online-tls" >&2
    exit 1
fi

"${KUBECTL[@]}" -n "$NAMESPACE" get pods,service,ingress,certificate
echo
echo "==> https://ruby.gihc.online"
