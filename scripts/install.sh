#!/bin/bash
set -e

# Verzeichnis des Skripts ermitteln
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. AppImage suchen
echo "Suche AppImage..."
# 1.1 In repo build-Verzeichnis
APPIMAGE_PATH=$(find "$REPO_ROOT/out/make/AppImage/x64" -name "steamlauncher-*-x64.AppImage" 2>/dev/null | head -n 1)

# 1.2 Im aktuellen Verzeichnis
if [ -z "$APPIMAGE_PATH" ]; then
  APPIMAGE_PATH=$(find . -maxdepth 2 -name "steamlauncher-*-x64.AppImage" 2>/dev/null | head -n 1)
fi

# 1.3 Im Skript-Verzeichnis
if [ -z "$APPIMAGE_PATH" ]; then
  APPIMAGE_PATH=$(find "$SCRIPT_DIR" -maxdepth 1 -name "steamlauncher-*-x64.AppImage" 2>/dev/null | head -n 1)
fi

# 1.4 Wenn nicht gefunden, von GitHub Release herunterladen
if [ -z "$APPIMAGE_PATH" ] || [ ! -f "$APPIMAGE_PATH" ]; then
  if ! command -v curl &> /dev/null; then
    echo "Fehler: AppImage nicht lokal gefunden und 'curl' wird für den Download benötigt."
    exit 1
  fi

  echo "Ermittle neueste Version von GitHub..."
  # Neuesten Release-Tag über die API abrufen
  LATEST_TAG=$(curl -s "https://api.github.com/repos/oliverzein/SteamLauncher/releases/latest" | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4)
  
  # Fallback bei Rate-Limit oder Verbindungsfehlern
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v1.6.0"
    echo "Konnte neueste Version nicht ermitteln. Nutze Fallback: $LATEST_TAG"
  else
    echo "Neueste Version gefunden: $LATEST_TAG"
  fi

  VERSION=${LATEST_TAG#v}
  OUT_FILE="steamlauncher-${VERSION}-x64.AppImage"
  URL="https://github.com/oliverzein/SteamLauncher/releases/download/${LATEST_TAG}/${OUT_FILE}"
  
  echo "Downloade $OUT_FILE..."
  if ! curl -# -f -L "$URL" -o "$OUT_FILE"; then
    echo "Fehler: Download fehlgeschlagen (HTTP-Fehler)."
    rm -f "$OUT_FILE"
    exit 1
  fi
  
  if [ -f "$OUT_FILE" ] && [ -s "$OUT_FILE" ]; then
    APPIMAGE_PATH="$OUT_FILE"
  else
    echo "Fehler: Download fehlgeschlagen."
    exit 1
  fi
fi

# Absolute Pfadangabe sicherstellen
APPIMAGE_PATH=$(realpath "$APPIMAGE_PATH")
echo "AppImage gefunden/geladen: $APPIMAGE_PATH"

# AppImage ELF-Signatur prüfen
if [ ! -f "$APPIMAGE_PATH" ] || [ "$(head -c 4 "$APPIMAGE_PATH" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]; then
  echo "Fehler: Die Datei '$APPIMAGE_PATH' ist kein gültiges AppImage (ungültige ELF-Signatur)."
  # Heruntergeladene Datei aufräumen
  if [ -n "$OUT_FILE" ] && [ "$APPIMAGE_PATH" = "$(realpath "$OUT_FILE" 2>/dev/null)" ]; then
    rm -f "$OUT_FILE"
  fi
  exit 1
fi

# 2. Icon suchen
ICON_PATH=""
if [ -f "$REPO_ROOT/assets/app-icon.png" ]; then
  ICON_PATH="$REPO_ROOT/assets/app-icon.png"
elif [ -f "./app-icon.png" ]; then
  ICON_PATH="./app-icon.png"
elif [ -f "$SCRIPT_DIR/app-icon.png" ]; then
  ICON_PATH="$SCRIPT_DIR/app-icon.png"
fi

# 3. Zielverzeichnisse erstellen
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons"

# 4. AppImage kopieren und ausführbar machen
echo "Installiere AppImage nach $HOME/.local/bin/steamlauncher..."
cp "$APPIMAGE_PATH" "$HOME/.local/bin/steamlauncher"
chmod +x "$HOME/.local/bin/steamlauncher"

# 5. Icon kopieren / extrahieren
if [ -n "$ICON_PATH" ]; then
  echo "Installiere Icon von $ICON_PATH..."
  cp "$ICON_PATH" "$HOME/.local/share/icons/steamlauncher.png"
else
  echo "Versuche Icon aus dem AppImage zu extrahieren..."
  # Temporäres Verzeichnis für die Extraktion erstellen
  TEMP_DIR=$(mktemp -d)
  (
    cd "$TEMP_DIR"
    # AppImage ausführbar machen (falls es das noch nicht ist)
    chmod +x "$APPIMAGE_PATH"
    # Extrahiere AppImage (erstellt squashfs-root/)
    "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1 || true
    
    if [ -f "squashfs-root/steamlauncher.png" ]; then
      cp "squashfs-root/steamlauncher.png" "$HOME/.local/share/icons/steamlauncher.png"
      echo "Icon erfolgreich aus AppImage extrahiert (steamlauncher.png)."
    elif [ -f "squashfs-root/.DirIcon" ]; then
      cp "squashfs-root/.DirIcon" "$HOME/.local/share/icons/steamlauncher.png"
      echo "Icon erfolgreich aus AppImage extrahiert (.DirIcon)."
    else
      # Nach sonstigen PNGs in assets suchen
      FOUND_ICON=$(find squashfs-root -name "app-icon.png" -o -name "steamlauncher.png" -o -name "icon.png" 2>/dev/null | head -n 1)
      if [ -n "$FOUND_ICON" ]; then
        cp "$FOUND_ICON" "$HOME/.local/share/icons/steamlauncher.png"
        echo "Icon erfolgreich aus AppImage extrahiert ($FOUND_ICON)."
      else
        echo "Warnung: Konnte kein Icon im AppImage finden."
      fi
    fi
  )
  rm -rf "$TEMP_DIR"
fi

# 6. Desktop-Eintrag erstellen
echo "Erstelle Desktop-Eintrag..."
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

# 7. Desktop-Datenbank aktualisieren
echo "Aktualisiere Desktop-Datenbank..."
update-desktop-database "$HOME/.local/share/applications" || true

echo "Installation abgeschlossen! SteamLauncher ist jetzt im Startmenü verfügbar."
