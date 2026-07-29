#!/bin/bash

# Cleanup script for Electron app uninstallation

set -e

echo "Running cleanup script for SkDAI..."

# Remove desktop entry
DESKTOP_FILE="/usr/share/applications/anming-SkDAI.desktop"
if [ -f "$DESKTOP_FILE" ]; then
    echo "Removing desktop entry..."
    if command -v pkexec >/dev/null 2>&1; then
        pkexec rm -f "$DESKTOP_FILE"
    elif command -v sudo >/dev/null 2>&1; then
        sudo rm -f "$DESKTOP_FILE"
    else
        echo "Warning: Cannot remove desktop entry, please manually delete: $DESKTOP_FILE"
    fi
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    echo "Updating desktop database..."
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

# Remove application directory if it exists and is empty
APP_DIR="/opt/SkDAI"
if [ -d "$APP_DIR" ]; then
    echo "Checking application directory for cleanup..."
    if [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
        echo "Removing empty application directory..."
        rmdir "$APP_DIR" 2>/dev/null || true
    fi
fi
# Remove Soft_link
LINK_PATH="/usr/bin/SkDAI"
if [ -L "$LINK_PATH" ]; then
  rm "$LINK_PATH"
  echo "✅ 已删除软链接：$LINK_PATH"
fi

echo "Cleanup completed successfully"

exit 0