#!/usr/bin/env bash
# Deploy the t3code server to a remote box (Hetzner or any Debian/Ubuntu host).
#
# Why remote: agent work — bash, builds, greps over 12k files — is what actually
# eats this laptop. Measured before writing this: 15.2 GB RSS on a 24 GB machine
# with 5.6 GB swapped, and 67 stray jcode processes. The reaper fixed the leak;
# this moves the remaining load off the laptop entirely so the Mac is a screen,
# not a worker.
#
# What this does NOT do: expose the server to the public internet. The pairing
# token is the only credential, so the port stays firewalled and you reach it
# over Tailscale or an SSH tunnel. Anything else is handing a shell to the world.
#
# Usage:
#   scripts/deploy-remote.sh user@host            # deploy + start
#   scripts/deploy-remote.sh user@host --sync     # push NOW.md/creds only
set -euo pipefail

TARGET="${1:?usage: deploy-remote.sh user@host [--sync]}"
MODE="${2:-full}"
REMOTE_DIR="/opt/t3code"
REMOTE_HOME="/var/lib/t3code"
PORT="${T3CODE_REMOTE_PORT:-3773}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

# ---------------------------------------------------------------- sync inputs
# The server reads three host-specific inputs. On a VPS they do not exist, so we
# push them and point the server at them with env overrides.
sync_inputs() {
  say "Syncing inputs to $TARGET"
  ssh "$TARGET" "mkdir -p $REMOTE_HOME/knowledge-org $REMOTE_HOME/secrets"
  if [[ -f "$HOME/.jcode/knowledge-org/NOW.md" ]]; then
    scp -q "$HOME/.jcode/knowledge-org/NOW.md" "$TARGET:$REMOTE_HOME/knowledge-org/NOW.md"
    echo "  NOW.md pushed"
  fi
  for f in google_credentials.json google_oauth.json; do
    if [[ -f "$HOME/.jcode/$f" ]]; then
      scp -q "$HOME/.jcode/$f" "$TARGET:$REMOTE_HOME/secrets/$f"
      ssh "$TARGET" "chmod 600 $REMOTE_HOME/secrets/$f"
      echo "  $f pushed (mode 600)"
    fi
  done
}

if [[ "$MODE" == "--sync" ]]; then
  sync_inputs
  say "Sync complete. Restart the service to pick up new credentials:"
  echo "  ssh $TARGET 'systemctl restart t3code'"
  exit 0
fi

# ------------------------------------------------------------------- build
say "Building server bundle"
npx vp run --filter t3 build >/dev/null
test -f apps/server/dist/bin.mjs || { echo "build produced no bin.mjs"; exit 1; }
echo "  apps/server/dist/bin.mjs ($(du -h apps/server/dist/bin.mjs | cut -f1))"

# ------------------------------------------------------------------- ship
say "Shipping to $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p $REMOTE_DIR $REMOTE_HOME"
scp -q apps/server/dist/bin.mjs "$TARGET:$REMOTE_DIR/bin.mjs"
sync_inputs

# --------------------------------------------------------------- prerequisites
say "Checking remote Node"
ssh "$TARGET" 'command -v node >/dev/null && node -v' || {
  echo "  Node missing. Install Node 24+ on the box, then re-run:"
  echo "    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
}

# ------------------------------------------------------------------- service
say "Installing systemd unit"
ssh "$TARGET" "sudo tee /etc/systemd/system/t3code.service >/dev/null" <<UNIT
[Unit]
Description=T3 Code server (remote agent execution)
After=network-online.target

[Service]
Type=simple
# Bind to all interfaces, but keep the port firewalled: reach it over Tailscale
# or an SSH tunnel. The pairing token is the only credential this speaks.
ExecStart=$(ssh "$TARGET" 'command -v node') $REMOTE_DIR/bin.mjs serve --host 0.0.0.0 --port $PORT --no-browser
Environment=T3CODE_HOME=$REMOTE_HOME
Environment=T3CODE_NOW_MD=$REMOTE_HOME/knowledge-org/NOW.md
Environment=T3CODE_GOOGLE_CREDENTIALS=$REMOTE_HOME/secrets/google_credentials.json
Environment=T3CODE_GOOGLE_TOKEN=$REMOTE_HOME/secrets/google_oauth.json
Restart=always
RestartSec=5
# Dayflow is Mac-only screen data; leaving it unset makes the panel degrade
# gracefully rather than fail.

[Install]
WantedBy=multi-user.target
UNIT

ssh "$TARGET" "sudo systemctl daemon-reload && sudo systemctl enable --now t3code && sleep 3 && sudo systemctl is-active t3code"

say "Verifying"
ssh "$TARGET" "curl -s -m 5 -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1:$PORT/"
ssh "$TARGET" "curl -s -m 5 http://127.0.0.1:$PORT/api/today | head -c 100; echo"

say "Pairing token (needed once, from the desktop app)"
ssh "$TARGET" "sudo journalctl -u t3code -n 60 --no-pager | grep -iE 'pairing url|token:' | tail -2" || \
  echo "  none in the log yet: ssh $TARGET 'sudo journalctl -u t3code -f'"

cat <<NEXT

Done. To use it from the desktop app, tunnel the port (do NOT open it publicly):

  ssh -N -L $PORT:127.0.0.1:$PORT $TARGET

then point the app at http://127.0.0.1:$PORT and pair with the token above.

Better long-term: install Tailscale on both machines and reach it at the
tailnet IP, which survives reboots and IP changes.

To refresh NOW.md and Gmail credentials later:
  scripts/deploy-remote.sh $TARGET --sync && ssh $TARGET 'sudo systemctl restart t3code'
NEXT
