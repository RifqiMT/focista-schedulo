#!/usr/bin/env bash
# Link a Neon pooled DATABASE_URL to this Vercel project (Production + Preview).
# Usage:
#   DATABASE_URL='postgresql://…@…-pooler….neon.tech/neondb?sslmode=require' npm run neon:link
# Or:
#   ./scripts/link-neon-vercel.sh 'postgresql://…'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

URL="${1:-${DATABASE_URL:-}}"
if [[ -z "${URL}" ]]; then
  echo "Missing DATABASE_URL."
  echo "1) Create a Neon Free project: https://console.neon.tech"
  echo "2) Copy the pooled connection string (-pooler host)."
  echo "3) Run: DATABASE_URL='postgresql://…' npm run neon:link"
  exit 1
fi

if [[ "${URL}" != postgresql://* && "${URL}" != postgres://* ]]; then
  echo "DATABASE_URL must start with postgresql:// or postgres://"
  exit 1
fi

echo "Adding DATABASE_URL to Vercel (production, preview, development)…"
# Non-interactive add for each environment
for ENV in production preview development; do
  # Remove existing to allow replace (ignore errors if missing)
  npx --yes vercel@latest env rm DATABASE_URL "$ENV" --yes >/dev/null 2>&1 || true
  printf '%s' "$URL" | npx --yes vercel@latest env add DATABASE_URL "$ENV" >/dev/null
  echo "  ✓ DATABASE_URL set for $ENV"
done

npx --yes vercel@latest env rm STORAGE_BACKEND production --yes >/dev/null 2>&1 || true
printf '%s' "neon" | npx --yes vercel@latest env add STORAGE_BACKEND production >/dev/null 2>&1 || true
echo "  ✓ STORAGE_BACKEND=neon (production)"

echo "Redeploying production…"
npx --yes vercel@latest deploy --prod --yes

echo "Checking /health…"
sleep 3
curl -sS "https://focista-schedulo.vercel.app/health" | python3 -m json.tool || true
echo
echo "Done. Expect storage=neon, neon.ok=true, ephemeralStorage=false."
