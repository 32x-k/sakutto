import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const outputRoot = join(root, '.output');
const firefoxDir = join(outputRoot, 'firefox-mv3');
const androidDir = join(outputRoot, 'firefox-android-mv3');
const xpiPath = join(outputRoot, `sakutto-${version}-firefox-android-lite.xpi`);

const FIREFOX_ANDROID_MIN_VERSION = '128.0';

function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

run('node', ['scripts/sync-pdfjs.mjs']);
run('node', ['scripts/sync-licenses.mjs']);
run('pnpm', ['exec', 'wxt', 'build', '-b', 'firefox']);

rmSync(androidDir, { recursive: true, force: true });
cpSync(firefoxDir, androidDir, { recursive: true });

// Patch manifest for Firefox for Android (local-server lightweight package):
// - Add gecko_android with strict_min_version 128.0 (local-server needs no JSPI/WebGPU)
// - Drop desktop-only contextMenus permission
const manifestPath = join(androidDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.permissions = (manifest.permissions ?? []).filter((p) => p !== 'contextMenus');
manifest.browser_specific_settings = {
  ...manifest.browser_specific_settings,
  gecko_android: {
    strict_min_version: FIREFOX_ANDROID_MIN_VERSION,
  },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// Strip bundled wllama WASM (~26.5 MB) for lightweight local-server Android package.
rmSync(join(androidDir, 'vendor', 'wllama'), { recursive: true, force: true });

if (existsSync(xpiPath)) rmSync(xpiPath, { force: true });
execFileSync(
  'python3',
  [
    '-c',
    `import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root_dir, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root_dir, name)
            rel = os.path.relpath(full, src).replace(os.sep, '/')
            zf.write(full, rel)
`,
    androidDir,
    xpiPath,
  ],
  { stdio: 'inherit' },
);

const sizeMb = (statSync(xpiPath).size / (1024 * 1024)).toFixed(2);
console.log(`[android] built lightweight unsigned XPI: ${xpiPath} (${sizeMb} MiB)`);
