#!/usr/bin/env bash
set -euo pipefail
LABEL="${SERVICE_LABEL:-com.imessage-assistant.server}"
# Installs made before the label was genericised still use the old one.
LEGACY_LABEL="com.ryanauhl.imessage-assistant"
if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
   && launchctl print "gui/$(id -u)/$LEGACY_LABEL" >/dev/null 2>&1; then
  LABEL="$LEGACY_LABEL"
fi
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed $LABEL (data dir left in place)"
