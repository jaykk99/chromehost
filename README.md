# ChromeHost

Self-hosted app platform for Chromebook. Run all your apps from your Chromebook with no cloud hosting needed.

Based on [Monico Labs](https://github.com/jaykk99/Monico-labs).

## What It Does

- Dashboard to deploy and manage all your apps (`/#/chromehost`)
- API key generation — **Generate API Key** button, keys shown once, revocable anytime
- Remote API so your AI assistant can manage apps using the API key (`X-API-Key` header)
- Composio integration for Gmail, social posting, and more (paste key in Settings or set env var)
- Built-in headless Chromium in the Docker image for browser automation (Puppeteer)
- Sandboxed command runner for app management (git, docker, npm…)
- One-click deploy for all your GitHub repos
- No Render, no cloud host required — everything runs on your machine

## Quick Start (Chromebook Linux)

### 1. Enable Linux on Chromebook

Settings → Advanced → Developers → **Linux development environment** → Turn on.
Give it at least 20 GB disk.

### 2. One-command install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/jaykk99/chromehost/main/install.sh | bash
```

This installs Docker, clones the repo, builds the image, and starts ChromeHost
on port 3000 with `--restart unless-stopped`. Then open
`http://<chromebook-ip>:3000/#/chromehost` and click **Generate API Key**.

### 3. Manual install

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker and git
sudo apt-get install -y docker.io git curl
sudo usermod -aG docker $USER
# Log out and back into the Linux terminal after this

# Install Node.js 20 (for non-Docker runs)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

```bash
git clone https://github.com/jaykk99/chromehost.git
cd chromehost
npm install
npm run build
```

### 4. Configure

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your keys:
# - COMPOSIO_API_KEY (from composio.dev) — also pasteable in the Settings UI
# - Any other API keys your apps need
nano .env
```

### 5. Run with Docker (recommended)

```bash
# Build the image
docker build -t chromehost .

# Run it (persists data, restarts on boot, can manage sibling containers)
docker run -d \
  --name chromehost \
  -p 3000:3000 \
  -v chromehost-data:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file .env \
  --restart unless-stopped \
  chromehost

# Check it's running
docker logs chromehost

# Open in browser: http://localhost:3000/#/chromehost
```

The Docker socket mount lets ChromeHost build and run your apps as sibling
containers. Without it, one-click deploys will fail.

### 6. Run without Docker (Node directly)

```bash
npm start
# Open in browser: http://localhost:3000/#/chromehost
```

Note: without Docker, app deploys via the API will report "Docker is not
available". The dashboard, API keys, and remote API still work.

## API Key Setup

1. Open `http://<chromebook-ip>:3000/#/chromehost` in your Chromebook browser
2. Click **Generate API Key**
3. Copy the key (shown once only)
4. Click **Save & use this key**, or send the key to your AI assistant so it can
   manage apps remotely

Revoke/regenerate anytime from the same page. Keys are stored as SHA-256 hashes —
the raw key is never stored.

## Remote API

All endpoints require the `X-API-Key` header. Base path: `/api/chromehost`.

```bash
# Set your key and host
export CHROMEHOST_KEY="your-api-key-here"
export CHROMEHOST_URL="http://localhost:3000/api/chromehost"
H="X-API-Key: $CHROMEHOST_KEY"

# Health check (also proves your key works)
curl -H "$H" $CHROMEHOST_URL/health

# List deployed apps + one-click registry
curl -H "$H" $CHROMEHOST_URL/apps

# Deploy an app (by registry name, or any repo)
curl -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"name":"ops-board"}' \
  $CHROMEHOST_URL/apps/deploy

curl -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"repo":"https://github.com/jaykk99/my-app.git","runtime":"node","build":"npm install && npm run build","start":"npm start"}' \
  $CHROMEHOST_URL/apps/deploy

# Start/stop an app
curl -X POST -H "$H" $CHROMEHOST_URL/apps/my-app/stop
curl -X POST -H "$H" $CHROMEHOST_URL/apps/my-app/start

# View logs
curl -H "$H" "$CHROMEHOST_URL/apps/my-app/logs?tail=200"

# API keys
curl -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"name":"my-laptop"}' $CHROMEHOST_URL/keys
curl -H "$H" $CHROMEHOST_URL/keys
curl -X DELETE -H "$H" $CHROMEHOST_URL/keys/2

# Composio (needs COMPOSIO_API_KEY set via env or Settings page)
curl -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"tool":"GMAIL_SEND_EMAIL","args":{}}' \
  $CHROMEHOST_URL/composio/execute

# Sandboxed shell (allowlisted commands: git, docker, npm, node, python3, pip, curl, ls, cat, df, du, uptime, hostname)
curl -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"command":"docker","args":["ps"]}' \
  $CHROMEHOST_URL/exec
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/chromehost/health | Health check (key auth) |
| GET | /api/chromehost/apps | List deployed apps + registry |
| POST | /api/chromehost/apps/deploy | Deploy a GitHub repo |
| POST | /api/chromehost/apps/:name/start | Start an app |
| POST | /api/chromehost/apps/:name/stop | Stop an app |
| POST | /api/chromehost/apps/:name/restart | Restart an app |
| GET | /api/chromehost/apps/:name/logs | View app logs |
| POST | /api/chromehost/keys | Generate API key |
| GET | /api/chromehost/keys | List keys (metadata only) |
| DELETE | /api/chromehost/keys/:id | Revoke a key |
| GET | /api/chromehost/settings | Composio key status (masked) |
| POST | /api/chromehost/settings/composio-key | Save Composio key |
| DELETE | /api/chromehost/settings/composio-key | Remove stored key |
| POST | /api/chromehost/composio/execute | Call a Composio tool |
| POST | /api/chromehost/exec | Sandboxed shell command |

## Composio Setup

ChromeHost uses your Composio key for Gmail, social posting, and other tools.

- **Option A (env):** set `COMPOSIO_API_KEY` in `.env` before starting.
- **Option B (UI):** open `/#/chromehost`, paste the key in the Composio section,
  click Save. Stored server-side in SQLite, never sent back to the browser.

The agent then calls tools via `POST /api/chromehost/composio/execute`
without ever handling the raw key.

## External Access (Cloudflare Tunnel)

To access ChromeHost from outside your home:

```bash
# Install cloudflared
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Quick public URL (random subdomain, free)
cloudflared tunnel --url http://localhost:3000
```

For a stable subdomain, create a free Cloudflare account:

```bash
cloudflared tunnel login
cloudflared tunnel create chromehost
cloudflared tunnel route dns chromehost chromehost.yourdomain.com
cloudflared tunnel --config ~/.cloudflared/config.yml run &
```

Then your phone and your AI assistant can reach the API from anywhere using
the tunnel URL + your API key.

## Keep Chromebook Awake

- ChromeOS Settings → Device → Power → **When lid is closed: Keep awake**
  (while charging). Keep it plugged in.
- The Docker container uses `--restart unless-stopped`, so ChromeHost and your
  apps come back after reboots.

## Pre-configured Apps

One-click deploy available for:
- error-inbox (Next.js — needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
- wholesale-stack (Python FastAPI — needs SUPABASE_URL + SUPABASE_KEY)
- ops-board (Next.js — needs SUPABASE_URL + SUPABASE_KEY)
- forge3d (static)
- train-studio (static)
- proquote (Next.js, from geniequote repo)
- mcp-tester (Next.js)
- voicecheck (Next.js)
- api-bell (Next.js)

Apps needing secrets take them as deploy-time env vars — never stored in git.

## Troubleshooting

```bash
# View logs
docker logs chromehost

# Restart
docker restart chromehost

# Full reset (deletes all data)
docker stop chromehost && docker rm chromehost
docker volume rm chromehost-data
# Then re-run the docker run command above
```

---

# Monico Labs (base platform)

ChromeHost is built on the Monico Labs base below (Vite frontend, Express
backend, embedded SQLite, MCP server) — all of that keeps working.
