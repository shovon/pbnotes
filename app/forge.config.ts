import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The binary would otherwise be named after `productName`, "Pb Notes". The
    // Linux makers look for one matching the package `name`. Not on macOS:
    // there the packager also writes this into CFBundleDisplayName, after
    // `extendInfo` has had its say, and the Dock would read "pbnotes".
    executableName: process.platform === 'darwin' ? undefined : 'pbnotes',
    // Also derived from `productName` unless said, and it would have become
    // `com.electron.pb-notes`.
    appBundleId: 'com.electron.pbnotes',
    // No extension: the packager takes icon.icns on macOS and icon.ico on
    // Windows. All three files come from assets/make-icons.sh.
    icon: 'assets/icon',
    // NSHumanReadableCopyright on macOS, where the About panel shows it, and
    // the .exe properties on Windows.
    appCopyright: 'Copyright © 2026 Sal Rahman',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/icon.ico',
      // Add/Remove Programs fetches its icon, so this has to be a URL.
      iconUrl: 'https://raw.githubusercontent.com/shovon/pbnotes/main/app/assets/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { icon: 'assets/icon.png' } }),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
