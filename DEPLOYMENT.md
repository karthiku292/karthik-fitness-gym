# Deploying KARTHIK FITNESS GYM

This guide deploys the full stack (PostgreSQL + FastAPI + React) to a **Linux VM**
(AWS EC2 / DigitalOcean / Azure / etc.) using Docker, with automatic HTTPS via Caddy.

## Prerequisites
- A Linux instance (Ubuntu 22.04+ recommended) with a public IP.
- Ports **80** and **443** open in the instance's firewall / security group.
- (Recommended) A domain name with a DNS **A record** pointing to the instance IP.
- SSH access to the instance.

## 1. Install Docker on the instance
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER      # then log out/in once
```

## 2. Get the code onto the instance
Either push this project to GitHub and clone it, or copy it up with scp.
```bash
git clone <your-repo-url> gym
cd gym
```

## 3. Configure production environment
```bash
cp deploy/.env.prod.example deploy/.env.prod
nano deploy/.env.prod
```
Set real values:
- `DOMAIN` and `PUBLIC_URL` (use your domain; `https://...`)
- `SECRET_KEY` → run `openssl rand -hex 32`
- `POSTGRES_PASSWORD` → a strong password
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` → your admin login

> No domain yet? Set `DOMAIN` to the public IP and `PUBLIC_URL=http://<ip>`.
> HTTPS needs a real domain; with an IP you'll run HTTP only (fine for testing).

## 4. Launch
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```
On first boot the backend runs database migrations and creates your admin user.

- Site:  `https://<your-domain>`
- API docs: `https://<your-domain>/api/v1/openapi.json`
- Log in with the bootstrap admin you set in `.env.prod`.

## 5. Day-2 operations
```bash
# View logs
docker compose -f deploy/docker-compose.prod.yml logs -f

# Update after code changes
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build

# Back up the database
docker compose -f deploy/docker-compose.prod.yml exec db \
  pg_dump -U gym gym > backup_$(date +%F).sql

# Create another admin
docker compose -f deploy/docker-compose.prod.yml exec backend \
  python -m app.db.create_admin --email you@example.com --password "StrongPass1!" --name "You"
```

## Notes
- The database is **not** exposed to the internet (no host port) — only reachable inside Docker.
- Caddy auto-provisions and renews a free Let's Encrypt certificate for your domain.
- Secrets live only in `deploy/.env.prod` (git-ignored) — never in the code or image.
- The local SQLite dev database is independent; production uses PostgreSQL.

## No domain? Deploy on the public IP (HTTP)

Use this when you only have the instance's IP (no domain yet).

1. In your cloud console, open inbound ports **22** (SSH, your IP) and **80** (HTTP, anywhere).
2. Note the instance's **public IPv4**.
3. On the instance:
   ```bash
   cp deploy/.env.ip.example deploy/.env.ip
   nano deploy/.env.ip          # set PUBLIC_URL=http://<public-ip>, SECRET_KEY, passwords, admin
   docker compose -f deploy/docker-compose.ip.yml --env-file deploy/.env.ip up -d --build
   ```
4. Open `http://<public-ip>` — share that link for others to use.

When you later get a domain, point its DNS A-record at the IP and switch to
`docker-compose.prod.yml` (adds automatic HTTPS). Note: the QR attendance
scanner (a later feature) needs HTTPS to access the camera, so a domain is
recommended before that goes live.

## Managed-platform alternative (no server to manage)
If you prefer **Render** / **Railway** instead of a VM, tell me and I'll add the
platform blueprint (a managed Postgres + web services, deploy-on-git-push). The
Dockerfiles here work on those platforms too.
