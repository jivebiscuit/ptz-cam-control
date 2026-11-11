// electron-builder afterPack hook (macOS only): ad-hoc sign the finished app ("-" = no certificate).
// Editing the app's Info.plist (needed for the Local Network permission text) breaks Electron's own signature,
// and without a valid signature macOS may refuse to launch it or never ask for Local Network access.
// Deliberately NOT signed with any keychain identity: this is a personal build, not a distributable one.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'inherit' });
};
