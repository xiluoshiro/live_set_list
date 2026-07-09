# LiveSetList Production Runbook

This directory contains production deployment templates for a single Google Cloud Compute Engine VM.

Target baseline:

- VM: Google Compute Engine `e2-medium`
- OS: Debian 13 is acceptable; Debian 12 or Ubuntu 24.04 LTS are also safe choices
- Disk: 30 GB minimum, 40 GB recommended, Balanced Persistent Disk
- Public ports: 80 and 443 only
- Private services: backend on `127.0.0.1:8000`, PostgreSQL on `127.0.0.1:${POSTGRES_PORT}`

## Server Layout

```text
/opt/livesetlist/releases/<version>  release archives unpack here
/opt/livesetlist/current             symlink to the active release
/etc/livesetlist                     production env files
/var/log/livesetlist                 backend logs
/var/backups/livesetlist             database backup dumps
```

Create the runtime user and directories:

```bash
sudo useradd --system --home /opt/livesetlist --shell /usr/sbin/nologin livesetlist
sudo mkdir -p /opt/livesetlist/releases /etc/livesetlist /var/log/livesetlist /var/backups/livesetlist
sudo chown -R livesetlist:livesetlist /opt/livesetlist /var/log/livesetlist /var/backups/livesetlist
sudo chmod 750 /etc/livesetlist
```

## First Deploy

1. Build frontend locally: `cd frontend && npm run build`.
2. Build release archive: `python scripts/build_release.py --version <version>`.
3. Upload `dist-release/livesetlist-<version>.tar.gz` to the VM.
4. Unpack to `/opt/livesetlist/releases/<version>` and update `/opt/livesetlist/current`.
5. Copy `env.production.example` to `/etc/livesetlist/backend.env` and `/etc/livesetlist/postgres.env`, then fill real secrets.
6. Start PostgreSQL with `docker compose --env-file /etc/livesetlist/postgres.env -f /opt/livesetlist/current/infra/production/docker-compose.postgres.yml up -d`.
7. Run Flyway validate/migrate against the private PostgreSQL port.
8. Install and start `livesetlist-backend.service`.
9. Install Nginx config from `nginx.livesetlist.conf.template`, replace placeholders, and reload Nginx.
10. Enable `livesetlist-backup.timer`.

## Admin Bootstrap

For first deploy only, set these in `/etc/livesetlist/backend.env`:

```env
AUTH_DEFAULT_ADMIN_ENABLED=true
AUTH_DEFAULT_ADMIN_USERNAME=<admin-user>
AUTH_DEFAULT_ADMIN_PASSWORD=<strong-random-password>
AUTH_DEFAULT_ADMIN_DISPLAY_NAME=<display-name>
```

Start the backend once, confirm login, then set:

```env
AUTH_DEFAULT_ADMIN_ENABLED=false
```

Restart the backend after disabling bootstrap.

## Verification

Run these checks after deployment:

```bash
curl -f http://127.0.0.1:8000/
curl -f http://127.0.0.1:8000/api/health/db
sudo systemctl status livesetlist-backend
sudo systemctl status livesetlist-backup.timer
sudo ss -ltnp
```

The `ss` output must not show PostgreSQL listening on `0.0.0.0:5432` or `0.0.0.0:${POSTGRES_PORT}`.
