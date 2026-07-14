# LiveSetList Production Runbook

This directory contains the production templates and server-side deployment entry for the live Google Cloud Compute Engine VM. Tag-based GitHub Actions deployment is verified; the operational procedure is in [docs/production-deployment-runbook.md](../../docs/production-deployment-runbook.md).

Target baseline:

- VM: Google Compute Engine `e2-medium`
- OS: Debian 12 Bookworm image `debian-12-bookworm-v20260609`
- Disk: 30 GB minimum, 40 GB recommended, Balanced Persistent Disk
- Public ports: 80 and 443 only
- Private services: backend on `127.0.0.1:8000`, PostgreSQL on `127.0.0.1:${POSTGRES_PORT}`

## Google Cloud Firewall

Allow only:

- TCP 22 from your admin IP
- TCP 80 from `0.0.0.0/0` and `::/0`
- TCP 443 from `0.0.0.0/0` and `::/0`

Do not expose PostgreSQL, backend port 8000, or Docker daemon ports.

## Debian 12 Packages

Install the runtime packages on Debian 12:

```bash
sudo apt update
sudo apt install -y nginx python3 python3-venv python3-pip docker.io docker-compose-plugin certbot python3-certbot-nginx
sudo systemctl enable --now docker nginx
```

The project is developed with Python 3.12. Debian 12's default Python may be older, so run `python3 --version` before creating the backend venv. If it is not acceptable for the current dependency set, install Python 3.12 from a trusted package source before deploying.

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
sudo chown -R root:root /opt/livesetlist
sudo chown -R livesetlist:livesetlist /var/log/livesetlist /var/backups/livesetlist
sudo chmod 750 /etc/livesetlist
```

Every release under `/opt/livesetlist/releases` must stay root-owned and non-writable by `livesetlist`. The backend only needs read access to application files and write access to `/var/log/livesetlist`. The backup unit runs as root because it invokes Docker, but its writable path is limited to `/var/backups/livesetlist`.

## First Deploy

1. Build frontend locally: `cd frontend && npm run build`.
2. Build release archive: `python scripts/build_release.py --version <version>`.
3. Upload `dist-release/livesetlist-<version>.tar.gz` to the VM.
4. Unpack to `/opt/livesetlist/releases/<version>` as root and update `/opt/livesetlist/current`; do not make the release writable by `livesetlist`.
5. Copy `env.production.example` to `/etc/livesetlist/backend.env` and `/etc/livesetlist/postgres.env`, then fill real secrets. Keep `APP_LOG_FILE=/var/log/livesetlist/app.log`.
6. Start PostgreSQL with `docker compose --env-file /etc/livesetlist/postgres.env -f /opt/livesetlist/current/infra/production/docker-compose.postgres.yml up -d`.
7. Run Flyway validate/migrate against the private PostgreSQL port.
8. Install and start `livesetlist-backend.service`.
9. Install Nginx config from `nginx.livesetlist.conf.template`, replace placeholders, and reload Nginx.
10. Enable `livesetlist-backup.timer`.

## GitHub Actions Deployment Bootstrap

The release workflow is triggered only by a `vYYYY-MM-DD-NNN` tag. It builds a release archive after isolated PostgreSQL/Flyway CI and `functional`, waits for the `production` Environment approval, then uploads that exact archive to the VM. This path is verified for releases without Flyway SQL changes.

Install the root-owned deployment script once:

```bash
sudo install -o root -g root -m 755 \
  /opt/livesetlist/current/infra/production/livesetlist-deploy \
  /usr/local/sbin/livesetlist-deploy
```

Create a separate deploy-only SSH user for GitHub Actions. Its sudoers entry must allow only this script, not a general root shell:

```text
livesetlist-deploy ALL=(root) NOPASSWD: /usr/local/sbin/livesetlist-deploy *
```

Configure the GitHub `production` Environment with `DEPLOY_SSH_PRIVATE_KEY` and `DEPLOY_KNOWN_HOSTS` secrets, plus `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, and `PUBLIC_BASE_URL` variables. Keep database and application env files only under `/etc/livesetlist` on the VM.

The script rejects any release whose Flyway SQL differs from the active release. Production V9 -> V11 was completed manually with backup, safe env parsing, `migrate`, `validate`, and a hand-controlled app switch. The next automation step is a protected two-stage migration workflow: migration attestation first, app switch only after that attestation matches the archive SHA-256. The installed `/usr/local/sbin/livesetlist-deploy` is intentionally outside release directories; after changing the template, an administrator must install the new script there before the next automated release.

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

Check production logs:

```bash
sudo journalctl -u livesetlist-backend -n 100 --no-pager
sudo tail -n 100 /var/log/livesetlist/app.log
```
