// SPDX-License-Identifier: GPL-3.0-or-later
// Release build (P1.9, architecture.md §1.2): the SLATE app and the standalone
// relay as Node single executables, each in a folder with its own files.
//
//   node tools/release/build.mjs --what app   --target win-x64
//   node tools/release/build.mjs --what relay --target linux-arm64 --archive
//
// Options:
//   --what app|relay      the app (Windows only) or slate-relay
//   --target T            win-x64 | linux-x64 | linux-arm64 (default: this machine)
//   --version V           default: the root package.json version
//   --node PATH           Node binary of the target (default: this Node for this
//                         machine, else downloaded from nodejs.org – same version)
//   --archive             also pack the folder (.zip for Windows, .tar.gz else)
//   --out DIR             default: dist/release
//
// The app folder is what `vpk pack` packs into the installer (see
// .github/workflows/release.yml); the relay folder is zipped as it is.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { setGuiSubsystem } from './pe.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(join(ROOT, 'apps', 'host', 'package.json'));
const esbuild = require('esbuild');

const { values } = parseArgs({
  options: {
    what: { type: 'string' },
    target: { type: 'string' },
    version: { type: 'string' },
    node: { type: 'string' },
    archive: { type: 'boolean' },
    out: { type: 'string' },
  },
});

const TARGETS = {
  'win-x64': { os: 'win', exe: '.exe', node: 'win-x64', archive: 'zip' },
  'linux-x64': { os: 'linux', exe: '', node: 'linux-x64', archive: 'tar.xz' },
  'linux-arm64': { os: 'linux', exe: '', node: 'linux-arm64', archive: 'tar.xz' },
};
const here = `${platform() === 'win32' ? 'win' : platform()}-${arch()}`;
const target = values.target ?? here;
const t = TARGETS[target];
if (!t) throw new Error(`Unknown target ${target} (${Object.keys(TARGETS).join(', ')})`);
const what = values.what;
if (what !== 'app' && what !== 'relay') throw new Error('--what app|relay');
// The app is installed on Windows only; a Linux build is for tests (no installer, no updates).
if (what === 'app' && t.os !== 'win')
  process.stdout.write('[release] app for Linux: test build only\n');

const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = values.version ?? rootPackage.version;
const sha = gitSha();
const build = sha ? `${version}+${sha}` : version;
const out = resolve(values.out ?? join(ROOT, 'dist', 'release'));
const name = what === 'app' ? 'slate' : 'slate-relay';
const folder = join(out, `${name}-${version}-${target}`);
const work = join(out, `.work-${what}-${target}`);
const exeName = (what === 'app' ? 'SLATE' : 'slate-relay') + t.exe;

const log = (line) => process.stdout.write(`[release] ${line}\n`);

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: 'inherit', ...options });
}

// ---------------------------------------------------------------------------
// 1. Bundle the entry point into one CommonJS file.

async function bundle() {
  const entry = join(ROOT, 'apps', 'host', 'src', what === 'app' ? 'main.ts' : 'relay-main.ts');
  const outfile = join(work, `${name}.cjs`);
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
    // Optional native speed-ups of ws, loaded in try/catch – not shipped.
    external: ['bufferutil', 'utf-8-validate'],
    define: {
      SLATE_RELEASE_BUILD: JSON.stringify(build),
      // Only read while developing (paths.ts, app/velopack.ts); a packaged build uses its own folder.
      'import.meta.url': JSON.stringify('file:///slate-release-bundle.cjs'),
    },
  });
  return { outfile, inputs: Object.keys(result.metafile.inputs) };
}

// ---------------------------------------------------------------------------
// 2. The Node binary of the target, same version as this one.

function nodeBinary() {
  if (values.node)
    return { exe: resolve(values.node), license: findNodeLicense(resolve(values.node)) };
  if (target === here) return { exe: process.execPath, license: findNodeLicense(process.execPath) };
  const v = process.version;
  const base = `node-${v}-${t.node}`;
  const file = `${base}.${t.archive}`;
  const cache = join(tmpdir(), 'slate-node', v);
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, file);
  if (!existsSync(archive)) {
    log(`Downloading ${file}`);
    run('curl', ['-fsSL', '-o', archive, `https://nodejs.org/dist/${v}/${file}`]);
  }
  const dir = join(cache, base);
  if (!existsSync(dir)) {
    if (t.archive === 'zip') run('unzip', ['-q', archive, '-d', cache]);
    else run('tar', ['-xJf', archive, '-C', cache]);
  }
  const exe = t.os === 'win' ? join(dir, 'node.exe') : join(dir, 'bin', 'node');
  return { exe, license: join(dir, 'LICENSE') };
}

function findNodeLicense(exe) {
  for (const candidate of [join(dirname(exe), 'LICENSE'), join(dirname(exe), '..', 'LICENSE')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Single executable: blob from the bundle, injected into a copy of Node.

function singleExecutable(bundleFile, node, exe) {
  const blob = join(work, 'sea.blob');
  const config = join(work, 'sea-config.json');
  writeFileSync(
    config,
    JSON.stringify({
      main: bundleFile,
      output: blob,
      disableExperimentalSEAWarning: true,
      // Must stay off: the blob is made by this Node for another platform's Node.
      useSnapshot: false,
      useCodeCache: false,
    }),
  );
  run(process.execPath, ['--experimental-sea-config', config]);
  cpSync(node.exe, exe);
  const postject = join(dirname(require.resolve('postject/package.json')), 'dist', 'cli.js');
  run(process.execPath, [
    postject,
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]);
}

// ---------------------------------------------------------------------------
// 4. Licences of everything that ships (GPL-3.0 §4–6, the MIT notices).

function packageDir(file) {
  let dir = dirname(resolve(ROOT, file));
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    const file = join(dir, 'package.json');
    // Some packages have inner package.json files without a name (module type markers).
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name) return dir;
    dir = dirname(dir);
  }
  return null;
}

function licenceText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

function thirdPartyLicences(dirs, nodeLicense) {
  const seen = new Map();
  for (const dir of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (!pkg.name || pkg.name.startsWith('@slate-dcs/') || seen.has(pkg.name)) continue;
    seen.set(pkg.name, { pkg, text: licenceText(dir) });
  }
  const parts = [
    'SLATE ships with these third-party components. SLATE itself is under the',
    'GNU General Public License v3.0 or later (LICENSE).',
    '',
  ];
  if (!nodeLicense || !existsSync(nodeLicense))
    log('Warning: no Node.js LICENSE found next to the Node binary');
  if (nodeLicense && existsSync(nodeLicense)) {
    parts.push('='.repeat(78), 'Node.js (the runtime inside the executable)', '='.repeat(78));
    parts.push(readFileSync(nodeLicense, 'utf8').trim(), '');
  }
  for (const [pkgName, { pkg, text }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(
      '='.repeat(78),
      `${pkgName} ${pkg.version ?? ''} – ${pkg.license ?? 'see below'}`,
      '='.repeat(78),
    );
    parts.push(
      text ?? `(no licence file in the package; licence field: ${pkg.license ?? '–'})`,
      '',
    );
  }
  return `${parts.join('\n')}\n`;
}

/** Package folders of a pnpm dependency and what it depends on (production only). */
function productionTree(fromDir, names, seen = new Set()) {
  const req = createRequire(join(fromDir, 'package.json'));
  const dirs = [];
  for (const dep of names) {
    let dir;
    try {
      dir = dirname(req.resolve(`${dep}/package.json`));
    } catch {
      continue;
    }
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    dirs.push(...productionTree(dir, Object.keys(pkg.dependencies ?? {}), seen));
  }
  return dirs;
}

// ---------------------------------------------------------------------------

async function main() {
  rmSync(work, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(folder, { recursive: true });
  log(`${what} ${build} for ${target} → ${relative(ROOT, folder)}`);

  if (what === 'app') {
    log('Building the web UI');
    run('pnpm', ['--filter', '@slate-dcs/web', 'build'], {
      cwd: ROOT,
      env: { ...process.env, SLATE_BUILD: build },
      shell: process.platform === 'win32',
    });
  }

  const { outfile, inputs } = await bundle();
  const node = nodeBinary();
  const exe = join(folder, exeName);
  singleExecutable(outfile, node, exe);
  // The app runs without a window (decided 23 Oct 2026); SLATE logs to a file.
  if (what === 'app' && t.os === 'win')
    log(`PE subsystem ${String(setGuiSubsystem(exe))} → 2 (no console window)`);

  const licenceDirs = inputs.map(packageDir).filter((d) => d !== null);
  cpSync(join(ROOT, 'LICENSE'), join(folder, 'LICENSE'));

  if (what === 'app') {
    cpSync(join(ROOT, 'apps', 'web', 'dist'), join(folder, 'web'), { recursive: true });
    cpSync(join(ROOT, 'dcs', 'export', 'Scripts'), join(folder, 'lua'), { recursive: true });
    // Velopack's native module, loaded from disk (app/velopack.ts): only the Windows x64 binary.
    const hostDir = join(ROOT, 'apps', 'host');
    const tree = productionTree(hostDir, ['velopack']);
    for (const dir of tree) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const dest = join(folder, 'node_modules', ...pkg.name.split('/'));
      cpSync(dir, dest, {
        recursive: true,
        dereference: true,
        filter: (src) =>
          !/\.node$/.test(src) || basename(src) === 'velopack_nodeffi_win_x64_msvc.node',
      });
    }
    licenceDirs.push(...tree);
    // The web UI's own runtime parts.
    const webDir = join(ROOT, 'apps', 'web');
    const web = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'));
    licenceDirs.push(...productionTree(webDir, [...Object.keys(web.dependencies ?? {}), 'svelte']));
  } else {
    mkdirSync(join(folder, 'server-hook'));
    cpSync(
      join(ROOT, 'dcs', 'server-hook', 'Scripts', 'Hooks', 'SLATE-server-hook.lua'),
      join(folder, 'server-hook', 'SLATE-server-hook.lua'),
    );
    cpSync(join(ROOT, 'tools', 'release', 'relay-README.txt'), join(folder, 'README.txt'));
  }
  writeFileSync(
    join(folder, 'THIRD-PARTY-LICENSES.txt'),
    thirdPartyLicences(licenceDirs, node.license),
  );
  writeFileSync(join(folder, 'VERSION.txt'), `${build}\n`);

  if (values.archive) {
    const base = basename(folder);
    if (t.archive === 'zip') {
      const zip = join(out, `${base}.zip`);
      rmSync(zip, { force: true });
      if (process.platform === 'win32') {
        run('powershell', [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${folder}\\*' -DestinationPath '${zip}'`,
        ]);
      } else {
        run('zip', ['-qr', zip, '.'], { cwd: folder });
      }
      log(`Archive ${relative(ROOT, zip)}`);
    } else {
      const tgz = join(out, `${base}.tar.gz`);
      run('tar', ['-czf', tgz, '-C', out, base]);
      log(`Archive ${relative(ROOT, tgz)}`);
    }
  }
  rmSync(work, { recursive: true, force: true });
  log('Done');
}

await main();
