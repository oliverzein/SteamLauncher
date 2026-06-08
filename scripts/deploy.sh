#!/bin/bash
set -e

# 1. AppImage bauen
echo "Baue AppImage..."
npm run make -- --targets=AppImage

# 2. Gebautes AppImage lokalisieren
APPIMAGE_PATH=$(find out/make/AppImage/x64 -name "steamlauncher-*-x64.AppImage" | head -n 1)

if [ -z "$APPIMAGE_PATH" ]; then
  echo "Fehler: AppImage-Build nicht gefunden."
  exit 1
fi

echo "Gefundenes AppImage: $APPIMAGE_PATH"

# 3. Version aus package.json auslesen
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo "Erkannte Version: $VERSION (Tag: $TAG)"

# 4. Release auf GitHub erstellen / aktualisieren
echo "Prüfe GitHub-Release für Tag $TAG..."
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release $TAG existiert bereits. Aktualisiere AppImage-Asset..."
  gh release upload "$TAG" "$APPIMAGE_PATH" --clobber
else
  echo "Erstelle neues GitHub-Release für $TAG und lade AppImage hoch..."
  gh release create "$TAG" "$APPIMAGE_PATH" --title "$TAG" --notes "Release $TAG"
fi

echo "Veröffentlichung auf GitHub erfolgreich abgeschlossen!"
