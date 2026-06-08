# Building and Running the AppImage

This guide explains how to build an AppImage for SteamLauncher and how to run it locally.

## Prerequisites

- Node.js and npm installed
- Project dependencies installed (from the project root):

```bash
npm install
```

- AppImage maker for Electron Forge (already added to this repo via devDependency):
  - Package: `@reforged/maker-appimage`
  - Configured in `forge.config.ts` under the `makers` array

- System dependency: `mksquashfs` (from `squashfs-tools`)
  - Arch / CachyOS:
    ```bash
    sudo pacman -S --needed squashfs-tools
    ```
  - Debian / Ubuntu:
    ```bash
    sudo apt-get update
    sudo apt-get install squashfs-tools
    ```

If you leave other Linux makers (RPM/Deb) enabled in `forge.config.ts`, you may also need their external tools (e.g., `rpmbuild` for RPM, `dpkg` for Deb). If you only want AppImage, either remove the other makers or pass the AppImage target only (see below).

## Build the AppImage

From the project root:

- Build ONLY the AppImage target:

```bash
npm run make -- --targets=AppImage
```

- Or build all configured makers (may require additional external tools):

```bash
npm run make
```

On success, Forge will place artifacts under the output folder:

```
./out/make/AppImage/x64/
```

You should see a file like:

```
./out/make/AppImage/x64/steamlauncher-<version>-x64.AppImage
```

Example:

```
./out/make/AppImage/x64/steamlauncher-1.0.0-x64.AppImage
```

## Run the AppImage

Make the AppImage executable and run it:

```bash
chmod +x out/make/AppImage/x64/steamlauncher-*-x64.AppImage
./out/make/AppImage/x64/steamlauncher-*-x64.AppImage
```

You can also double‑click the file in your file manager once it’s marked executable.

On first run, your desktop environment may prompt for AppImage desktop integration (optional). Accept it if you want a menu entry to be created.

## Troubleshooting

- Error: `Cannot make for AppImage, the following external binaries need to be installed: mksquashfs`
  - Install the system dependency:
    - Arch / CachyOS: `sudo pacman -S --needed squashfs-tools`
    - Debian / Ubuntu: `sudo apt-get install squashfs-tools`

- Error: `Cannot make for rpm, the following external binaries need to be installed: rpmbuild`
  - Either install the tool (e.g., `sudo pacman -S rpm-tools` or `sudo apt-get install rpm`) or build only the AppImage target:
    ```bash
    npm run make -- --targets=AppImage
    ```

- **Silent Hang/Exit during packaging (Node 26+ Compatibility)**
  - **Issue**: On newer Node.js runtimes (v26.1.0+), the `extract-zip`/`yauzl` library used inside `@electron/packager` triggers an early exit with code 0 before completing the extraction of the Electron binary archive.
  - **Fix**: The package was patched at `node_modules/@electron/packager/dist/unzip.js` to use the fast native system `unzip` utility on non-Windows platforms. Ensure the system `unzip` command is installed (available by default on CachyOS).

- Paths differ
  - Forge may vary the output path slightly by OS/arch. Check the list of artifacts:
    ```bash
    ls -R out/make
    ```

- Noisy console output during development
  - We’ve reduced stdout/stderr from the spawned Steam process and gated verbose logs. If you want extra logs, set:
    ```bash
    SL_VERBOSE=1 npm start
    ```

## Where it’s configured

- AppImage maker is configured in `forge.config.ts` in the `makers` array using:
  - `import { MakerAppImage } from '@reforged/maker-appimage'`
  - `new MakerAppImage({ /* options */ })`

You can customize desktop metadata (e.g., `category`) in that maker’s options.

