---
name: deploy
description: Deploy NanoClaw to VPS. Use when user says "deploy", "push to server", "restart server", "check deploy", or wants to ship code changes to production. Also handles stuck containers, failed restarts, and post-deploy verification.
---

# Deploy NanoClaw to VPS

Build, push, deploy via GitHub Actions, and verify the service is running on the VPS.

## VPS Access

SSH is configured via `~/.ssh/config` under host alias `mika`. All commands below use `ssh mika`.

- **Project path:** `/home/mika/mika`
- **Service:** `systemctl --user` (requires `XDG_RUNTIME_DIR=/run/user/$(id -u)`)
- **Logs:** `/home/mika/mika/logs/nanoclaw.log` and `nanoclaw.error.log`

## Deploy Flow

### 1. Build locally

```bash
npm run build
```

If build fails, fix errors before proceeding.

### 2. Commit and push

Commit changed files to `main` and push. This triggers the GitHub Actions deploy workflow (`.github/workflows/deploy.yml`).

### 3. Watch the deploy

```bash
gh run list --limit 1 --json databaseId,status,conclusion -q '.[0]'
gh run watch <run_id>
```

If the run fails, check logs:

```bash
gh run view <run_id> --log 2>&1 | tail -30
```

### 4. Verify service is running

```bash
ssh mika "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user status nanoclaw"
```

Check for `Active: active (running)`. If status shows `deactivating` or `failed`, see Auto-Fix below.

### 5. Check app logs

```bash
ssh mika "tail -30 /home/mika/mika/logs/nanoclaw.log"
```

Confirm the bot connected (look for `NanoClaw running` or `Telegram bot connected`).

## Auto-Fix: Common Issues

### Stuck in `deactivating (final-sigterm)`

A docker container from the previous session is blocking the restart.

```bash
ssh mika "docker ps --filter name=nanoclaw- -q | xargs -r docker kill"
ssh mika "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user restart nanoclaw"
```

### Service crash-looping (`exit-code` failures)

Check error log for root cause:

```bash
ssh mika "tail -20 /home/mika/mika/logs/nanoclaw.error.log"
```

Common causes: missing env vars, Docker not running, build artifacts stale.

### GitHub Actions SSH failure

- Fingerprint mismatch: Update `VPS_HOST_KEY` secret with ECDSA SHA256 fingerprint
- Connection timeout: Verify SSH port is open, host IP is correct
- Auth failure: Update `VPS_SSH_KEY` secret with private key from `~/.ssh/id_ed25519`

## Manual Deploy (skip GitHub Actions)

If CI is broken, deploy directly:

```bash
ssh mika "cd /home/mika/mika && git stash && git pull && npm install && npm run build && XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user restart nanoclaw"
```

## Reading VPS Logs

```bash
# App logs (recent)
ssh mika "tail -100 /home/mika/mika/logs/nanoclaw.log"

# Error logs
ssh mika "tail -30 /home/mika/mika/logs/nanoclaw.error.log"

# Systemd journal
ssh mika "XDG_RUNTIME_DIR=/run/user/\$(id -u) journalctl --user -u nanoclaw -n 50 --no-pager"
```
