#!/usr/bin/env bash
set -euo pipefail
LABEL="com.ryanauhl.imessage-assistant"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed $LABEL (data dir left in place)"
