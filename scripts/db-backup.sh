#!/usr/bin/env bash
# Manual logical backup for the MotoParts ERP Supabase project.
#
# Why this exists: the Supabase org is on the Free plan, which has no
# automatic daily backups and no PITR (both are Pro+ only). Supabase's own
# guidance for Free-tier projects is to run `supabase db dump` regularly and
# keep the output somewhere off this machine. This script is that command,
# wrapped so it's a one-line habit instead of something to remember by hand.
#
# This script does NOT touch git, does NOT contain any credentials, and does
# NOT upload the dump anywhere — `supabase login`/`link` will prompt you
# interactively the first time (browser-based auth), and after that this
# only needs re-running. Output lands in backups/, which is gitignored — do
# not remove that entry, the dump contains real customer names/phone
# numbers/addresses and must never be committed.
#
# Usage: ./scripts/db-backup.sh

set -euo pipefail

PROJECT_REF="dtttdgdkhayzchmfptjt"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/motoparts_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found. Install it first: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

echo "==> Linking to project $PROJECT_REF (will prompt to log in if needed)..."
supabase link --project-ref "$PROJECT_REF"

echo "==> Dumping database to $OUT_FILE ..."
supabase db dump -f "$OUT_FILE"

echo "==> Done. Backup written to: $OUT_FILE"
echo "==> Copy this file somewhere off this machine (cloud storage, external drive, etc.) — a local-only copy is not a real backup."
