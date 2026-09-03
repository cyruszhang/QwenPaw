#!/usr/bin/env bash
#
# sync-console-ui.sh — build the engine console frontend (the Data-Cloud
# host-core console) and vendor the output into this plugin as an
# embeddable static SPA under ui/public/data-console/.
#
# The build is patched (scripts/data-console/patches/console-embed.patch)
# to use hash routing, target the plugin's engine gateway paths
# (/api/v1/*), route Skills Hub to an open-source contribution page, drop
# the MCP settings surface, and disable SSO login redirects. The patch is
# applied with `git apply` and reverted afterwards; drift in the upstream
# checkout fails the build loudly.
#
# A classic-script bridge (scripts/data-console/paw-bridge.js) is injected
# into index.html so the same-origin iframe can attach the QwenPaw host
# auth token to gateway requests.
#
# Usage:
#   scripts/sync-console-ui.sh
#
# Environment:
#   DATA_CLOUD_DIR             Console source checkout
#                              (default: ~/dev/datapaw/QwenPaw-Data-Cloud)
#   ENGINE_GATEWAY_BASE        Gateway base path
#                              (default: /api/qwenpaw-data/engine)
#   CONTEXT_CONSOLE_URL        Vendored Context console entry (hash-router)
#   FORCE_INSTALL=1            Re-run npm install even if node_modules exists

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_CLOUD_DIR="${DATA_CLOUD_DIR:-$HOME/dev/datapaw/QwenPaw-Data-Cloud}"
FRONTEND_DIR="$DATA_CLOUD_DIR/packages/datapaw-host-core/frontend"
DEST_DIR="$APP_DIR/ui/public/data-console"
BRIDGE_FILE="$SCRIPT_DIR/data-console/paw-bridge.js"
PATCH_FILE="$SCRIPT_DIR/data-console/patches/console-embed.patch"
GATEWAY_BASE="${ENGINE_GATEWAY_BASE:-/api/qwenpaw-data/engine}"
CONTEXT_CONSOLE_URL="${CONTEXT_CONSOLE_URL:-/api/frontend_plugin/qwenpaw-data/files/ui/dist/context-console/index.html#}"

if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
  echo "Engine console frontend was not found: $FRONTEND_DIR" >&2
  echo "Set DATA_CLOUD_DIR to a QwenPaw-Data-Cloud checkout." >&2
  exit 1
fi
for required in "$BRIDGE_FILE" "$PATCH_FILE"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing sync input: $required" >&2
    exit 1
  fi
done

SOURCE_COMMIT="$(git -C "$DATA_CLOUD_DIR" rev-parse --short HEAD)"
SOURCE_BRANCH="$(git -C "$DATA_CLOUD_DIR" rev-parse --abbrev-ref HEAD)"
SOURCE_DIRTY="clean"
if [[ -n "$(git -C "$DATA_CLOUD_DIR" status --porcelain -uno)" ]]; then
  SOURCE_DIRTY="dirty"
  echo "WARNING: $DATA_CLOUD_DIR has uncommitted changes; the build will" \
    "not be reproducible from commit $SOURCE_COMMIT." >&2
fi
echo "==> Building engine console from $SOURCE_BRANCH@$SOURCE_COMMIT ($SOURCE_DIRTY)"

# --- Temporary source patch ---------------------------------------------------
if ! git -C "$DATA_CLOUD_DIR" apply --check "$PATCH_FILE"; then
  echo "console-embed.patch no longer applies to $DATA_CLOUD_DIR." >&2
  echo "Upstream drifted; regenerate the patch before syncing." >&2
  exit 1
fi
git -C "$DATA_CLOUD_DIR" apply "$PATCH_FILE"
restore_patch() {
  git -C "$DATA_CLOUD_DIR" apply -R "$PATCH_FILE" || {
    echo "FAILED to revert console-embed.patch in $DATA_CLOUD_DIR;" >&2
    echo "restore the checkout manually (git checkout -- ...)." >&2
  }
}
trap restore_patch EXIT

# --- Build --------------------------------------------------------------------
pushd "$FRONTEND_DIR" >/dev/null
if [[ ! -d node_modules || "${FORCE_INSTALL:-0}" == "1" ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi
VITE_API_BASE_URL="$GATEWAY_BASE" \
VITE_CONTEXT_FRONTEND_URL="$CONTEXT_CONSOLE_URL" \
  npm run build -- --base=./
popd >/dev/null

restore_patch
trap - EXIT

# --- Vendor the output ----------------------------------------------------------
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -R "$FRONTEND_DIR/dist/." "$DEST_DIR/"
cp "$BRIDGE_FILE" "$DEST_DIR/paw-bridge.js"

# Inject the auth bridge before the module bundle (classic scripts in <head>
# always execute before deferred module scripts) and make the app fill the
# iframe viewport.
perl -pi -e 's#<head>#<head><script src="./paw-bridge.js"></script><style>html,body,\#root{height:100%;margin:0}</style>#' \
  "$DEST_DIR/index.html"
if ! grep -q "paw-bridge.js" "$DEST_DIR/index.html"; then
  echo "Failed to inject paw-bridge.js into index.html" >&2
  exit 1
fi

# Rewrite root-absolute references to vendored public assets so they resolve
# relative to index.html when served from a subpath.
for asset in "$DEST_DIR"/*.png "$DEST_DIR"/*.mp4; do
  [[ -f "$asset" ]] || continue
  name="$(basename "$asset")"
  for target in "$DEST_DIR"/assets/*.js "$DEST_DIR"/assets/*.css \
    "$DEST_DIR/index.html"; do
    [[ -f "$target" ]] || continue
    ASSET_NAME="$name" perl -pi -e \
      's#(["\x27])/\Q$ENV{ASSET_NAME}\E#${1}./$ENV{ASSET_NAME}#g' "$target"
  done
done

# --- Hygiene gate: no internal endpoints in the public bundle -------------------
if grep -RIl -i -E "alibaba-inc|gitlab\.alibaba|login\.alibaba|bucsso|aliyun-inc" \
  "$DEST_DIR" >/dev/null 2>&1; then
  echo "Internal markers found in the vendored bundle; aborting." >&2
  grep -RIl -i -E "alibaba-inc|gitlab\.alibaba|login\.alibaba|bucsso|aliyun-inc" "$DEST_DIR" >&2
  exit 1
fi

cat > "$DEST_DIR/BUILD_INFO" <<EOF
source_repo=$DATA_CLOUD_DIR
source_branch=$SOURCE_BRANCH
source_commit=$SOURCE_COMMIT
source_tree=$SOURCE_DIRTY
gateway_base=$GATEWAY_BASE
context_console_url=$CONTEXT_CONSOLE_URL
built_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
patches=console-embed.patch
EOF

echo "==> Engine console vendored into $DEST_DIR"

# --- Rebuild the plugin UI so the assets land in ui/dist -------------------------
if [[ -d "$APP_DIR/ui/node_modules" ]]; then
  echo "==> Rebuilding the plugin UI bundle"
  (cd "$APP_DIR/ui" && npm run build)
else
  echo "NOTE: run 'npm install && npm run build' in $APP_DIR/ui to publish" \
    "the vendored console into ui/dist."
fi
