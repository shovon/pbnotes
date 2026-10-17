import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The binary would otherwise be named after `productName`, "Pb Notes". The
    // Linux makers look for one matching the package `name`. Not on macOS:
    // there the packager also writes this into CFBundleDisplayName, after
    // `extendInfo` has had its say, and the Dock would read "pbnotes".
    executableName: process.platform === 'darwin' ? undefined : 'pbnotes',
    // macOS keys preferences, saved state and granted folder permissions to
    // this, so changing it once people have installed the app orphans all of
    // that. Unset, the packager would derive `com.electron.pb-notes`.
    appBundleId: 'com.salrahman.pbnotes',
    // No extension: the packager takes icon.icns on macOS and icon.ico on
    // Windows. All three files come from assets/make-icons.sh.
    icon: 'assets/icon',
    // NSHumanReadableCopyright on macOS, where the About panel shows it, and
    // the .exe properties on Windows.
    appCopyright: 'Copyright © 2026 Sal Rahman',
  },
  rebuildConfig: {},
  hooks: {
    // Ad-hoc sign the whole bundle before the makers zip it up. The packager
    // renames and edits the app after Electron's own signature, so without this
    // Apple Silicon refuses to open it as "damaged" (#68). The Developer ID
    // follow-up replaces this with `osxSign`.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const dir of outputPaths) {
        for (const app of readdirSync(dir).filter((f) => f.endsWith('.app'))) {
          execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(dir, app)], { stdio: 'inherit' });
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/icon.ico',
      // Add/Remove Programs fetches its icon, so this has to be a URL.
      iconUrl: 'https://raw.githubusercontent.com/shovon/pbnotes/main/app/assets/icon.ico',
    }),
    // The DMG is the download people expect; the ZIP is what auto-update would
    // consume later (#67).
    new MakerDMG({ icon: 'assets/icon.icns' }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { icon: 'assets/icon.png' } }),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  // Drafts, so a Release is only public once someone has checked it (#67).
  publishers: [
    new PublisherGithub({
      repository: { owner: 'shovon', name: 'pbnotes' },
      draft: true,
    }),
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
