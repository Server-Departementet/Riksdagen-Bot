#!/bin/bash
# Run as root: app steps run as the riks user, system steps as root.
# The GitHub Actions deploy workflow runs this over SSH with --force on every
# push to the tracked branch; without --force it exits quietly unless
# origin/$BRANCH has new commits (handy for manual runs).
set -e

REPO=/home/riks/Riksdagen-Bot
# The branch this deployment tracks: main on the prod bot, dev on the dev bot.
BRANCH=dev

runuser -u riks -- git -C "$REPO" fetch origin
if [ "${1:-}" != "--force" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse "origin/$BRANCH")" ]; then
  exit 0
fi

runuser -u riks -- env BRANCH="$BRANCH" bash -c '
  set -e
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  cd "$HOME/Riksdagen-Bot"

  git checkout -B "$BRANCH" --force "origin/$BRANCH"

  printf "\n\033[1;32m================= UPDATED TO =================\033[0m\n"
  git log -1 --date=format:"%Y-%m-%d %H:%M:%S" --format="  commit:  %h%n  date:    %cd%n  message: %s"
  printf "\033[1;32m==============================================\033[0m\n\n"

  chmod +x systemd/*.sh

  yarn install --immutable
  # Regenerate both Prisma clients (own DB + web Quote mirror).
  # Schema *changes* to the own DB are applied manually (yarn prisma db push);
  # the web DBs are migrated by the web repo, never from here.
  yarn generate
'

# Log dir for the cron jobs (riks writes the logs)
mkdir -p /var/log/riksdagen-bot
chown riks:riks /var/log/riksdagen-bot

# Refresh cron + service definitions
crontab -u riks "$REPO/systemd/cron"
crontab "$REPO/systemd/cron.root"
cp "$REPO/systemd/discgolf.service" /etc/systemd/system/
cp "$REPO/systemd/assets.service" /etc/systemd/system/
systemctl daemon-reload

# Restart services only if they are currently running
systemctl try-restart discgolf.service
systemctl try-restart assets.service
