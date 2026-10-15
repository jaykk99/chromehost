#!/usr/bin/env bash
# ChromeHost one-command installer for Chromebook (Crostini Debian) and any Debian/Ubuntu box.
# Usage: curl -fsSL https://raw.githubusercontent.com/jaykk99/chromehost/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/jaykk99/chromehost.git"
APP_DIR="$HOME/chromehost"
IMAGE="chromehost"
CONTAINER="chromehost"

echo "==> ChromeHost installer"

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y docker.io git curl
  sudo usermod -aG docker "$USER" || true
  echo "NOTE: Docker group added. If 'docker ps' fails with permission denied,"
  echo "      close this terminal and open a new one, then re-run the script."
else
  echo "==> Docker already installed"
fi

# Make sure docker is usable (or fail with a clear message)
if ! docker ps >/dev/null 2>&1; then
  echo "ERROR: cannot run 'docker ps'. If you were just added to the docker group,"
  echo "       open a NEW terminal (group membership applies on login) and re-run:"
  echo "       curl -fsSL https://raw.githubusercontent.com/jaykk99/chromehost/main/install.sh | bash"
  exit 1
fi

# 2. Clone / update repo
if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating $APP_DIR"
  git -C "$APP_DIR" pull --ff-only || true
else
  echo "==> Cloning $REPO_URL"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

# 3. Build image
echo "==> Building Docker image (this takes a few minutes the first time)..."
docker build -t "$IMAGE" "$APP_DIR"

# 4. Start container
echo "==> Starting ChromeHost..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -p 3000:3000 \
  -v chromehost-data:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  "$IMAGE"

echo ""
echo "==> Done. ChromeHost is starting on port 3000."
echo "    Dashboard:  http://$(hostname -I | awk '{print $1}'):3000/#/chromehost"
echo "    Next step: open that page and click 'Generate API Key'."
echo "    Keep this Chromebook plugged in and awake for 24/7 hosting."
