# SteamLauncher

SteamLauncher is a modern, lightweight Electron-based application designed to manage and launch Steam games across multiple accounts seamlessly. It integrates with SteamCMD to automate game updates, securely stores credentials, and allows for account-specific launch configurations.

## Features

- **Multi-Account Support**: Manage and launch games using different Steam accounts with ease.
- **Secure Credential Storage**: Passwords are saved securely using the native OS keychain via `keytar`.
- **Automated Updates**: Integrates with SteamCMD to keep your game files up to date automatically.
- **Process Monitoring**: Robust lifecycle tracking of launched game processes.
- **Settings Management**: Configure launch resolutions, window modes, and other game-specific variables.

## Installation (Linux)

You can easily install SteamLauncher on your Linux desktop with a single command. The installer downloads the latest AppImage, integrates the application icon, and registers a menu entry in your desktop environment automatically.

Run this command in your terminal:

```bash
curl -sL "https://raw.githubusercontent.com/oliverzein/SteamLauncher/master/scripts/install.sh?t=\$(date +%s)" | bash
```

## Development & Documentation

For development, troubleshooting, and manual compilation instructions, please refer to the documentation in the [docs/](docs/) folder:

- [Building & Running the AppImage](docs/AppImage.md)
- [Architecture & Design Details](docs/Architecture.md)
- [Game Update Feature Details](docs/Game-Update-Feature.md)

## License

[MIT](LICENSE)
