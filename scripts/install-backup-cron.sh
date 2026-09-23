#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

install -d -m 0700 /root/vetensino/backups /root/vetensino/logs
chmod 0750 /root/vetensino/api/scripts/backup-databases.sh

cat > /etc/cron.d/vetensino-backup <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=America/Sao_Paulo
15 3 * * * root /root/vetensino/api/scripts/backup-databases.sh >> /root/vetensino/logs/backup.log 2>&1
CRON

chmod 0644 /etc/cron.d/vetensino-backup
echo "Cron installed: daily at 03:15 America/Sao_Paulo; S3 upload runs on Sundays."