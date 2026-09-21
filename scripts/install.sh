#!/bin/bash
set -e

# Verzeichnis des Skripts ermitteln
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FORCE_BUILD=false

# Argumente verarbeiten
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --build|-b)
      FORCE_BUILD=true
      shift
      ;;
    *)
      echo "Unbekannte Option: $1"
      echo "Verwendung: $0 [--build|-b]"
      exit 1
      ;;
  esac
done

NATIVE_BUILD_DIR="$REPO_ROOT/out/steamlauncher-linux-x64"

# 1. Native Build prüfen oder erstellen
if [ "$FORCE_BUILD" = true ] || [ ! -d "$NATIVE_BUILD_DIR" ]; then
  if [ -f "$REPO_ROOT/package.json" ]; then
    echo "Baue SteamLauncher mit 'npm run package'..."
    (cd "$REPO_ROOT" && npm run package)
  fi
fi

INSTALL_MODE=""
if [ -d "$NATIVE_BUILD_DIR" ] && [ -f "$NATIVE_BUILD_DIR/steamlauncher" ]; then
  INSTALL_MODE="native"
  echo "Nativer Build gefunden: $NATIVE_BUILD_DIR"
else
  echo "Kein nativer Build vorhanden. Prüfe Fallback auf AppImage..."
  INSTALL_MODE="appimage"
fi

# Fallback auf AppImage falls kein nativer Build verfügbar ist
if [ "$INSTALL_MODE" = "appimage" ]; then
  echo "Suche AppImage..."
  # In repo build-Verzeichnis
  APPIMAGE_PATH=$(find "$REPO_ROOT/out/make/AppImage/x64" -name "steamlauncher-*-x64.AppImage" 2>/dev/null | sort -V -r | head -n 1)

  # Im aktuellen Verzeichnis
  if [ -z "$APPIMAGE_PATH" ]; then
    APPIMAGE_PATH=$(find . -maxdepth 2 -name "steamlauncher-*-x64.AppImage" 2>/dev/null | sort -V -r | head -n 1)
  fi

  # Im Skript-Verzeichnis
  if [ -z "$APPIMAGE_PATH" ]; then
    APPIMAGE_PATH=$(find "$SCRIPT_DIR" -maxdepth 1 -name "steamlauncher-*-x64.AppImage" 2>/dev/null | sort -V -r | head -n 1)
  fi

  # Wenn nicht gefunden, von GitHub Release herunterladen
  if [ -z "$APPIMAGE_PATH" ] || [ ! -f "$APPIMAGE_PATH" ]; then
    if ! command -v curl &> /dev/null; then
      echo "Fehler: Weder nativer Build noch AppImage lokal gefunden, und 'curl' wird für den Download benötigt."
      exit 1
    fi

    echo "Ermittle neueste Version von GitHub..."
    LATEST_TAG=$(curl -s "https://api.github.com/repos/oliverzein/SteamLauncher/releases/latest" | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4)

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

  APPIMAGE_PATH=$(realpath "$APPIMAGE_PATH")
  echo "AppImage gefunden/geladen: $APPIMAGE_PATH"

  # AppImage ELF-Signatur prüfen
  if [ ! -f "$APPIMAGE_PATH" ] || [ "$(head -c 4 "$APPIMAGE_PATH" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]; then
    echo "Fehler: Die Datei '$APPIMAGE_PATH' ist kein gültiges AppImage (ungültige ELF-Signatur)."
    if [ -n "$OUT_FILE" ] && [ "$APPIMAGE_PATH" = "$(realpath "$OUT_FILE" 2>/dev/null)" ]; then
      rm -f "$OUT_FILE"
    fi
    exit 1
  fi
fi

# 2. Icon suchen
ICON_PATH=""
if [ -f "$REPO_ROOT/assets/app-icon.png" ]; then
  ICON_PATH="$REPO_ROOT/assets/app-icon.png"
elif [ -f "$NATIVE_BUILD_DIR/resources/assets/app-icon.png" ]; then
  ICON_PATH="$NATIVE_BUILD_DIR/resources/assets/app-icon.png"
elif [ -f "./app-icon.png" ]; then
  ICON_PATH="./app-icon.png"
elif [ -f "$SCRIPT_DIR/app-icon.png" ]; then
  ICON_PATH="$SCRIPT_DIR/app-icon.png"
fi

# 3. Zielverzeichnisse erstellen
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/lib"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons"
mkdir -p "$HOME/.config/autostart"

# 4. Installation durchführen
if [ "$INSTALL_MODE" = "native" ]; then
  echo "Installiere nativen Build nach $HOME/.local/lib/steamlauncher..."
  rm -rf "$HOME/.local/lib/steamlauncher"
  mkdir -p "$HOME/.local/lib/steamlauncher"
  cp -a "$NATIVE_BUILD_DIR/." "$HOME/.local/lib/steamlauncher/"
  chmod +x "$HOME/.local/lib/steamlauncher/steamlauncher"

  echo "Erstelle Symlink $HOME/.local/bin/steamlauncher -> $HOME/.local/lib/steamlauncher/steamlauncher..."
  rm -f "$HOME/.local/bin/steamlauncher"
  ln -s "$HOME/.local/lib/steamlauncher/steamlauncher" "$HOME/.local/bin/steamlauncher"
else
  echo "Installiere AppImage nach $HOME/.local/bin/steamlauncher..."
  rm -f "$HOME/.local/bin/steamlauncher"
  cp "$APPIMAGE_PATH" "$HOME/.local/bin/steamlauncher"
  chmod +x "$HOME/.local/bin/steamlauncher"
fi

# 5. Icon kopieren / extrahieren
if [ -n "$ICON_PATH" ]; then
  echo "Installiere Icon von $ICON_PATH..."
  cp "$ICON_PATH" "$HOME/.local/share/icons/steamlauncher.png"
elif [ "$INSTALL_MODE" = "appimage" ]; then
  echo "Versuche Icon aus dem AppImage zu extrahieren..."
  TEMP_DIR=$(mktemp -d)
  (
    cd "$TEMP_DIR"
    chmod +x "$APPIMAGE_PATH"
    "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1 || true

    if [ -f "squashfs-root/steamlauncher.png" ]; then
      cp "squashfs-root/steamlauncher.png" "$HOME/.local/share/icons/steamlauncher.png"
      echo "Icon erfolgreich aus AppImage extrahiert (steamlauncher.png)."
    elif [ -f "squashfs-root/.DirIcon" ]; then
      cp "squashfs-root/.DirIcon" "$HOME/.local/share/icons/steamlauncher.png"
      echo "Icon erfolgreich aus AppImage extrahiert (.DirIcon)."
    else
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

# 6. Desktop-Einträge erstellen / aktualisieren
echo "Erstelle Desktop-Eintrag in applications..."
cat <<EOF > "$HOME/.local/share/applications/steamlauncher.desktop"
[Desktop Entry]
Name=SteamLauncher
Comment=Steam account game launcher
Exec=${HOME}/.local/bin/steamlauncher
Icon=${HOME}/.local/share/icons/steamlauncher.png
Terminal=false
Type=Application
Categories=Game;Utility;
StartupWMClass=steamlauncher
EOF

echo "Erstelle Desktop-Eintrag in autostart..."
cat <<EOF > "$HOME/.config/autostart/Steam Launcher.desktop"
[Desktop Entry]
Name=Steam Launcher
Comment=Steam account game launcher
Exec=${HOME}/.local/bin/steamlauncher
Icon=${HOME}/.local/share/icons/steamlauncher.png
Terminal=false
Type=Application
Categories=Game;Utility;
StartupWMClass=steamlauncher
EOF

# 7. Desktop-Datenbank aktualisieren
echo "Aktualisiere Desktop-Datenbank..."
update-desktop-database "$HOME/.local/share/applications" || true

echo "Installation ($INSTALL_MODE) abgeschlossen! SteamLauncher ist jetzt einsatzbereit."
