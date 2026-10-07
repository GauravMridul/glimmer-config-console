#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v docker >/dev/null 2>&1; then
  DOCKER=(docker)
elif [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  DOCKER=(/Applications/Docker.app/Contents/Resources/bin/docker)
else
  echo "docker not found. Install Docker Desktop and either:" >&2
  echo "  - Add Docker to PATH (Docker Desktop → Settings → Advanced → CLI tools), or" >&2
  echo "  - Ensure /Applications/Docker.app/Contents/Resources/bin/docker exists." >&2
  exit 1
fi

docker_info_ok() {
  "${DOCKER[@]}" info >/dev/null 2>&1
}

if ! docker_info_ok; then
  # Docker Desktop (macOS) and Colima often use a non-default socket; try those before failing.
  for sock in "${HOME}/.docker/run/docker.sock" "/var/run/docker.sock" "${HOME}/.colima/default/docker.sock"; do
    if [[ -S "$sock" ]]; then
      export DOCKER_HOST="unix://${sock}"
      if docker_info_ok; then
        echo "Using DOCKER_HOST=${DOCKER_HOST}" >&2
        break
      fi
    fi
  done
fi

if ! docker_info_ok; then
  echo "Cannot talk to the Docker daemon (no docker.sock)." >&2
  echo "" >&2
  echo "Fix:" >&2
  echo "  1. Open Docker Desktop from Applications and wait until it says Docker is running." >&2
  echo "     (Colima: run  colima start  .)" >&2
  echo "  2. Run:  docker version   (you should see both Client and Server sections)." >&2
  echo "  3. If Server is missing, try:  export DOCKER_HOST=unix://\${HOME}/.docker/run/docker.sock" >&2
  echo "     (some Docker Desktop versions use that socket instead of /var/run/docker.sock)." >&2
  echo "  4. Docker Desktop → Settings → Advanced: enable \"Allow the default Docker socket to be used\" if offered." >&2
  exit 1
fi

exec "${DOCKER[@]}" build -t config-console:local \
  --build-arg VITE_USE_API=true \
  --build-arg VITE_API_URL= \
  --build-arg VITE_API_RELATIVE=true \
  --build-arg PUBLIC_BASE_PATH="${PUBLIC_BASE_PATH:-/}" \
  .
