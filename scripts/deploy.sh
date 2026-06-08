#!/bin/bash
set -e

# 1. Build the AppImage
echo "Building AppImage..."
npm run make -- --targets=AppImage

# 2. Locate built AppImage
APPIMAGE_PATH=$(find out/make/AppImage/x64 -name "steamlauncher-*-x64.AppImage" | head -n 1)

if [ -z "$APPIMAGE_PATH" ]; then
  echo "Error: AppImage build not found."
  exit 1
fi

echo "Found built AppImage: $APPIMAGE_PATH"

# 3. Create directories
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons"

# 4. Copy AppImage to bin and make executable
echo "Installing AppImage to $HOME/.local/bin/steamlauncher..."
cp "$APPIMAGE_PATH" "$HOME/.local/bin/steamlauncher"
chmod +x "$HOME/.local/bin/steamlauncher"

# 5. Copy icon
echo "Installing application icon..."
cp assets/app-icon.png "$HOME/.local/share/icons/steamlauncher.png"

# 6. Generate desktop entry
echo "Registering desktop entry..."
cat <<EOF > "$HOME/.local/share/applications/steamlauncher.desktop"
[Desktop Entry]
Name=SteamLauncher
Comment=Steam account game launcher
Exec=${HOME}/.local/bin/steamlauncher
Icon=steamlauncher
Terminal=false
Type=Application
Categories=Game;Utility;
StartupWMClass=steamlauncher
EOF

# 7. Update desktop database
echo "Updating desktop database..."
update-desktop-database "$HOME/.local/share/applications" || true

echo "Deployment complete! SteamLauncher is now available in your application launcher menu."
