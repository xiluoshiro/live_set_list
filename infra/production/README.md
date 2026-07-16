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

Both app-only and migration releases start from one `vYYYY-MM-DD-NNN` tag; a migration release does not use a second tag. The workflow builds one release archive after isolated PostgreSQL/Flyway CI and `functional`, uploads that exact archive to the VM, and classifies it against the active Flyway SQL. App-only releases continue through `production`; migration releases reuse the same version and SHA-256 in separate `migrate` and `deploy` workflow-dispatch runs.

Install the root-owned deployment script once:

```bash
sudo install -o root -g root -m 755 \
  /opt/livesetlist/current/infra/production/livesetlist-deploy \
  /usr/local/sbin/livesetlist-deploy
```

Create a separate deploy-only SSH user for GitHub Actions. Its sudoers entry must allow only the release prepare/migrate entrypoints and deploy script, not a general root shell:

```text
Cmnd_Alias LIVESETLIST_PREPARE = /usr/local/sbin/livesetlist-release-manager prepare *
Cmnd_Alias LIVESETLIST_MIGRATE = /usr/local/sbin/livesetlist-release-manager migrate *
Cmnd_Alias LIVESETLIST_DEPLOY = /usr/local/sbin/livesetlist-deploy *
livesetlist-deploy ALL=(root) NOPASSWD: LIVESETLIST_PREPARE, LIVESETLIST_MIGRATE, LIVESETLIST_DEPLOY
```

Configure `DEPLOY_SSH_PRIVATE_KEY` and `DEPLOY_KNOWN_HOSTS` as repository secrets because the prepare job intentionally runs before any Environment gate. Configure `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, and `PUBLIC_BASE_URL` as repository variables. Keep the `production` Environment and add `production-migration`; required reviewers are optional extra protection where the GitHub plan supports them. Keep database and application env files only under `/etc/livesetlist` on the VM.

The repository now contains a protected two-stage migration workflow. `release_manager.py prepare` classifies the exact archive against the VM's active Flyway SQL. App-only releases continue through the tag workflow; migration releases stop until two separate `workflow_dispatch` runs perform `migrate` and then `deploy`. Migration uses pinned `redgate/flyway:12.11.0`, creates a verified backup, writes a root-only attestation, and never automatically restores the database. `livesetlist-deploy` accepts a migration release only when the attestation, archive SHA-256, SQL tree hashes, and live Flyway version match.

The production VM entrypoints, state directories, sudoers rules, and GitHub configuration were installed for the initial two-stage rollout on 2026-07-17. The commands below are bootstrap/upgrade commands, not per-release steps; repeat them only when an administrator intentionally updates the root-owned entrypoints:

Upload both entrypoints as the deploy-only user. Keep the repeatable staging files in that user's home instead of fixed `/tmp/*.next` paths, which can become non-overwritable when an earlier copy is owned by another user:

```powershell
scp infra/production/release_manager.py livesetlist-deploy@<VM_IP>:/home/livesetlist-deploy/livesetlist-release-manager.next
scp infra/production/livesetlist-deploy livesetlist-deploy@<VM_IP>:/home/livesetlist-deploy/livesetlist-deploy.next
```

```bash
sudo install -o root -g root -m 755 /home/livesetlist-deploy/livesetlist-release-manager.next /usr/local/sbin/livesetlist-release-manager
sudo install -o root -g root -m 755 /home/livesetlist-deploy/livesetlist-deploy.next /usr/local/sbin/livesetlist-deploy
sudo install -d -o root -g root -m 700 /opt/livesetlist/staging
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/release-state
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/deploy-attestations
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/release-archives
sudo docker pull redgate/flyway:12.11.0
```

The exact sudoers rules, GitHub repository secrets/variables, activation order, and optional verification commands are in [docs/production-deployment-runbook.md](../../docs/production-deployment-runbook.md). Normal releases do not require an operator to SSH into the VM. The installed `/usr/local/sbin` files are intentionally outside release directories and must be updated by an administrator before a workflow that depends on a new entrypoint is enabled.

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
