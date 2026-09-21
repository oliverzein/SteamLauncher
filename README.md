# SteamLauncher

SteamLauncher is a modern, lightweight Electron-based application designed to manage and launch Steam games across multiple accounts seamlessly. It integrates with SteamCMD to automate game updates, securely stores credentials, and allows for account-specific launch configurations.

## Features

- **Multi-Account Support**: Manage and launch games using different Steam accounts with ease.
- **Secure Credential Storage**: Passwords are saved securely using the native OS keychain via `keytar`.
- **Automated Updates**: Integrates with SteamCMD to keep your game files up to date automatically.
- **Process Monitoring**: Robust lifecycle tracking of launched game processes.
- **Settings Management**: Configure launch resolutions, window modes, and other game-specific variables.

## Installation (Linux)

SteamLauncher installs as a native unpacked application into `~/.local/lib/steamlauncher` (symlinked to `~/.local/bin/steamlauncher`), avoiding FUSE overhead and kernel suspend deadlocks.

### From local repository (Recommended)

Build and install natively with a single command:

```bash
./scripts/install.sh
```

To force a fresh build before installing:

```bash
./scripts/install.sh --force-build
```

### Via curl (One-liner)

You can also run the installer script directly:

```bash
curl -sL "https://raw.githubusercontent.com/oliverzein/SteamLauncher/master/scripts/install.sh?t=\$(date +%s)" | bash
```

The installer automatically:
1. Builds the native package into `out/steamlauncher-linux-x64` (or falls back to AppImage if building is skipped/unavailable).
2. Installs the native binary to `~/.local/lib/steamlauncher` and creates a symlink at `~/.local/bin/steamlauncher`.
3. Registers desktop and autostart entries with the application icon in your desktop environment.

## Development & Documentation

For development, troubleshooting, and manual compilation instructions, please refer to the documentation in the [docs/](docs/) folder:

- [Building & Running the AppImage](docs/AppImage.md)
- [Architecture & Design Details](docs/Architecture.md)
- [Game Update Feature Details](docs/Game-Update-Feature.md)

## License

[MIT](LICENSE)
