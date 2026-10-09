#!/bin/bash
# setup-innosetup.sh — Install Inno Setup 6 under Wine (for Linux cross-compilation)
#
# Prerequisites: wine must be installed
#   Fedora: sudo dnf install wine
#   Ubuntu: sudo apt install wine
#
# This downloads and silently installs Inno Setup 6 into the Wine prefix.
# After running this, build-win.js can find ISCC.exe at:
#   ~/.wine/drive_c/Program Files (x86)/Inno Setup 6/ISCC.exe

set -e

INNO_VERSION="6.4.3"
INNO_URL="https://files.jrsoftware.org/is/6/innosetup-${INNO_VERSION}.exe"
INNO_INSTALLER="/tmp/innosetup-${INNO_VERSION}.exe"

# Check for wine
if ! command -v wine &> /dev/null; then
  echo "ERROR: wine is not installed."
  echo "  Fedora: sudo dnf install wine"
  echo "  Ubuntu: sudo apt install wine"
  exit 1
fi

# Download if not cached
if [ ! -f "$INNO_INSTALLER" ]; then
  echo "Downloading Inno Setup ${INNO_VERSION}..."
  curl -L -o "$INNO_INSTALLER" "$INNO_URL"
else
  echo "Using cached installer: $INNO_INSTALLER"
fi

# Install silently under Wine
echo "Installing Inno Setup ${INNO_VERSION} under Wine..."
wine "$INNO_INSTALLER" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-

# Verify
ISCC_PATH="$HOME/.wine/drive_c/Program Files (x86)/Inno Setup 6/ISCC.exe"
if [ -f "$ISCC_PATH" ]; then
  echo ""
  echo "Inno Setup installed successfully!"
  echo "  ISCC.exe: $ISCC_PATH"
  echo ""
  echo "You can now run: npm run package:win"
else
  echo "ERROR: ISCC.exe not found after installation."
  echo "Check Wine output above for errors."
  exit 1
fi
