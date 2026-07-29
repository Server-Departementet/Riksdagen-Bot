#!/bin/bash
# Run as root: app steps run as the riks user, system steps as root.
set -e

REPO=/home/riks/Riksdagen-Backend

runuser -u riks -- bash -c '
  set -e
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  cd "$HOME/Riksdagen-Backend"

  git fetch origin
  git checkout -B main --force origin/main

  printf "\n\033[1;32m================= UPDATED TO =================\033[0m\n"
  git log -1 --date=format:"%Y-%m-%d %H:%M:%S" --format="  commit:  %h%n  date:    %cd%n  message: %s"
  printf "\033[1;32m==============================================\033[0m\n\n"

  chmod +x systemd/*.sh

  yarn install --immutable
  # Regenerate both Prisma clients (own DB + web DB mirror).
  # Schema *changes* are applied manually (yarn prisma db push), not here.
  yarn generate
'

# Refresh cron + service definitions
crontab -u riks "$REPO/systemd/cron"
crontab "$REPO/systemd/cron.root"
cp "$REPO/systemd/discgolf.service" /etc/systemd/system/
cp "$REPO/systemd/assets.service" /etc/systemd/system/
systemctl daemon-reload

# Restart services only if they are currently running
systemctl try-restart discgolf.service
systemctl try-restart assets.service
