#!/bin/bash
# Nightly bidirectional delta sync between the prod and dev web databases, so
# each fully contains the other. Historically the environments fetched plays
# independently (with outages), and the takeout import queues are per
# environment — this closes both gaps. All inserts are INSERT IGNORE against
# primary keys, so identical rows written to both sides (the bot's own play +
# quote injection) are no-ops and near-duplicate handling is untouched.
#
# Deliberately NOT synced: SpotifyAccount (prod is the token source of truth),
# TrackPlayFetch and ImportQueueItem (environment-local by design).
set -e
cd /home/riks/Riksdagen-Bot

set -a
. ./.env
set +a

TABLES="Genre Album Artist Track _ArtistToGenre _ArtistToTrack User TrackPlay Quote"

parse_url() { # mysql://user:pass@host:port/db -> "user pass host port db"
  [[ "$1" =~ ^mysql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)$ ]] || {
    echo "Cannot parse database URL" >&2
    return 1
  }
  echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[4]} ${BASH_REMATCH[5]}"
}

sync_direction() { # sync_direction "label" <from-url> <to-url>
  local label=$1
  read -r FU FP FH FPORT FD <<< "$(parse_url "$2")"
  read -r TU TP TH TPORT TD <<< "$(parse_url "$3")"

  echo "Syncing $label..."
  # riks_bot has plain DML only — the dump must not emit LOCK TABLES or
  # ALTER TABLE ... DISABLE KEYS statements
  MYSQL_PWD="$FP" mariadb-dump --single-transaction --no-create-info --insert-ignore \
    --skip-add-locks --skip-disable-keys \
    -h "$FH" -P "$FPORT" -u "$FU" "$FD" $TABLES \
    | MYSQL_PWD="$TP" mariadb -h "$TH" -P "$TPORT" -u "$TU" "$TD"
  echo "Synced $label."
}

if [ -z "$WEB_DATABASE_URL_PROD" ] || [ -z "$WEB_DATABASE_URL_DEV" ]; then
  echo "Both web database URLs must be set; nothing to sync."
  exit 0
fi

sync_direction "dev -> prod" "$WEB_DATABASE_URL_DEV" "$WEB_DATABASE_URL_PROD"
sync_direction "prod -> dev" "$WEB_DATABASE_URL_PROD" "$WEB_DATABASE_URL_DEV"
