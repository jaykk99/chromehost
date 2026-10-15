# ChromeHost on a Chromebook (self-hosted, no paid services)

Turn any Chromebook into your own app server. Run all your apps — Error Inbox,
wholesale-stack, ops-board, forge3d, and the rest — from one machine with zero
cloud bills. Everything is embedded: SQLite for data, Docker for app
containers, and a remote API so you can manage it from your phone.

## 1. Enable Linux (Crostini)

Settings → Advanced → Developers → **Linux development environment** → Turn on.
Give it at least 16 GB disk (your apps need room). This gives you a Debian
container with a terminal.

## 2. One-command install

```bash
# inside the Linux terminal
curl -fsSL https://raw.githubusercontent.com/jaykk99/chromehost/main/install.sh | bash
```

That script: installs Docker, clones this repo, builds the image, and starts
ChromeHost on port 3000 with `--restart unless-stopped`.

Manual install if you prefer:

```bash
sudo apt-get update && sudo apt-get install -y docker.io
sudo usermod -aG docker $USER   # log out/in of the terminal after this
git clone https://github.com/jaykk99/chromehost.git
cd chromehost
docker build -t chromehost .
docker run -d --name chromehost -p 3000:3000 \
  -v chromehost-data:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  chromehost
```

Note: the Docker socket is mounted so ChromeHost can build and run your apps
as sibling containers.

## 3. Create your API key

Open `http://<chromebook-ip>:3000/#/chromehost` (find the IP with `hostname -I`).

Click **Generate API Key**. The key is shown once — copy it somewhere safe
(send it to your agent so it can manage the box remotely). You can revoke and
regenerate keys anytime from the same page.

Every remote call sends the key as an `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_KEY" http://<chromebook-ip>:3000/api/chromehost/health
```

## 4. Deploy your apps (one click)

On the `#/chromehost` page, the registry lists your repos with one-click
Deploy buttons: error-inbox, wholesale-stack, ops-board, forge3d,
train-studio, proquote, mcp-tester, voicecheck, api-bell.

Each deploy clones the repo, builds a Docker image, and starts a container on
its own localhost port. Apps needing secrets (Supabase keys etc.) take them as
deploy-time env vars — never stored in git.

Remote deploy from anywhere:

```bash
curl -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ops-board"}' http://HOST:3000/api/chromehost/apps/deploy
```

## 5. Keep it running 24/7

- Keep the Chromebook **plugged in**, lid open (or set "Sleep when lid is closed"
  to off while charging: Settings → Device → Power).
- `--restart unless-stopped` brings ChromeHost back after reboots; app
  containers use the same policy.
- Data persists in the `chromehost-data` Docker volume. Back it up with:
  `docker cp chromehost:/app/data/chromehost.db ./backup.db`

## 6. Reach it from outside your home (free)

```bash
# Cloudflare Tunnel — free, no port forwarding
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
./cloudflared tunnel --url http://localhost:3000
```

You get a public `https://<random>.trycloudflare.com` URL. For a stable
subdomain, create a free Cloudflare account and route a domain to the tunnel.
Then your phone and your agent can hit the API from anywhere.

## 7. MCP server

The MCP server from the Monico Labs base still works:

- `http://<chromebook-ip>:3000/api/mcp/sse` with
  `Authorization: <redacted> <token from the boot log>`

## Caveats (honest)

- The Chromebook must stay on and awake — if it sleeps, the apps sleep too.
- This box is as secure as your home network + API key. Use a strong key,
  revoke it if it leaks, and prefer the Cloudflare Tunnel URL over raw port
  forwarding.
- App containers share the Chromebook's CPU/RAM — fine for personal apps,
  not for heavy ML training.
- SQLite lives on local disk: fast and crash-safe, but back up `chromehost.db`
  if you care about the data.
