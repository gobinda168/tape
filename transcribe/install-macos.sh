#!/bin/sh
# Run tape-transcribe (Parakeet Redux on 127.0.0.1:8790) in the background on macOS:
# starts at login, restarts if it stops, logs to ~/Library/Logs/tape-transcribe.log.
#
#   transcribe/install-macos.sh            install (or update) and start
#   transcribe/install-macos.sh uninstall  stop and remove
set -eu

LABEL="local.tape.transcribe"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/tape-transcribe.log"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/tape_transcribe.py"
UV="$(command -v uv || true)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

[ -n "$UV" ] || { echo "uv is needed: brew install uv" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string><string>run</string><string>--quiet</string><string>$SCRIPT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$UV"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

printf "Starting"
i=0
while [ $i -lt 90 ]; do
  if curl -s -m 1 http://127.0.0.1:8790/health >/dev/null 2>&1; then
    echo; echo "tape-transcribe is running on http://127.0.0.1:8790 (log: $LOG)"
    exit 0
  fi
  printf "."; sleep 1; i=$((i + 1))
done
echo; echo "It didn't answer within 90 s. See $LOG" >&2
exit 1
