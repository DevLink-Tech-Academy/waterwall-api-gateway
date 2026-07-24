#!/bin/sh
set -e
# Emit the browser-visible runtime config into /__env.js (served from the app's
# public dir). Standalone Next.js bakes NEXT_PUBLIC_* at build time; this lets a
# single image be configured per deployment via container env.
PUBLIC_DIR="/app/${APP_NAME}/public"
mkdir -p "$PUBLIC_DIR"
{
  echo "window.__ENV = {"
  env | grep '^NEXT_PUBLIC_' | while IFS='=' read -r key val; do
    printf '  "%s": "%s",\n' "$key" "$val"
  done
  echo "};"
} > "$PUBLIC_DIR/__env.js"
exec node "/app/${APP_NAME}/server.js"
