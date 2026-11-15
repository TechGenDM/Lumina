// Builds the Chrome Web Store upload: dist/Lumina_v<version>.zip
//
//   npm run build
//
// Only the files the extension needs at runtime are included. Dev-only code is
// stripped, and the result is checked before it is zipped.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'unpacked');

// Everything that ships. Anything not listed here stays out of the ZIP.
const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'output.html',
  'output.js',
  'editor.html',
  'editor.js',
  'fabric.min.js',
  'jspdf.umd.min.js'
];
const RUNTIME_DIRS = ['icons'];

function fail(message) {
  console.error(`\n✖ Build failed: ${message}`);
  process.exit(1);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

// ---- 1. Stage the runtime files -------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const zipName = `Lumina_v${manifest.version}.zip`;
const zipPath = path.join(DIST, zipName);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const file of RUNTIME_FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) fail(`missing runtime file: ${file}`);
  fs.copyFileSync(src, path.join(STAGE, file));
}
for (const dir of RUNTIME_DIRS) {
  for (const file of listFiles(path.join(ROOT, dir))) {
    if (path.basename(file).startsWith('.')) continue; // .DS_Store etc.
    const dest = path.join(STAGE, dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, dir, file), dest);
  }
}

// ---- 2. Strip dev-only code from background.js ----------------------------
const bgPath = path.join(STAGE, 'background.js');
const bgSource = fs.readFileSync(bgPath, 'utf8');
const bgRelease = bgSource.replace(/^[ \t]*\/\/ @dev-only-start[\s\S]*?\/\/ @dev-only-end[^\n]*\n?/gm, '');
if (bgRelease === bgSource) fail('the @dev-only block was not found in background.js');
fs.writeFileSync(bgPath, bgRelease);

// ---- 3. Verify the staged build -------------------------------------------
const staged = listFiles(STAGE);
const exists = (rel) => fs.existsSync(path.join(STAGE, rel));

// 3a. Manifest basics
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`invalid version "${manifest.version}"`);
if ((manifest.description || '').length > 132) fail('manifest description is longer than 132 characters');

// 3b. Every file the manifest points at exists
const manifestRefs = [
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  manifest.background && manifest.background.service_worker
].filter(Boolean);
for (const ref of manifestRefs) {
  if (!exists(ref)) fail(`manifest.json references a missing file: ${ref}`);
}

// 3c. Every local script/stylesheet/image the HTML pages point at exists,
//     and nothing is loaded from the network or written inline
for (const page of staged.filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(STAGE, page), 'utf8');
  for (const match of html.matchAll(/<(?:script|img|link|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = match[1];
    if (/^(https?:)?\/\//i.test(ref)) fail(`${page} loads a remote resource: ${ref}`);
    if (/^(data:|#)/i.test(ref)) continue;
    if (!exists(ref.split(/[?#]/)[0])) fail(`${page} references a missing file: ${ref}`);
  }
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${page} contains an inline <script> (not allowed in MV3)`);
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail(`${page} contains an inline event handler (not allowed in MV3)`);
}

// 3d. Pages opened from the scripts exist
for (const script of ['background.js', 'output.js', 'editor.js']) {
  const code = fs.readFileSync(path.join(STAGE, script), 'utf8');
  for (const match of code.matchAll(/["'`]([\w-]+\.html)\b/g)) {
    if (!exists(match[1])) fail(`${script} references a missing page: ${match[1]}`);
  }
}

// 3e. No dev leftovers, remote code or eval anywhere in the package
const FORBIDDEN = [
  [/localhost|127\.0\.0\.1/i, 'a localhost reference (dev code)'],
  [/dev-reloader|@dev-only/i, 'dev-only code'],
  [/\beval\s*\(|new\s+Function\s*\(/, 'eval / new Function'],
  [/https?:\/\/(?:[\w-]+\.)*(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|googleapis\.com|gstatic\.com)/i, 'a CDN URL (remote code)']
];
for (const file of staged.filter((f) => /\.(js|html|json)$/.test(f))) {
  const text = fs.readFileSync(path.join(STAGE, file), 'utf8');
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(text)) fail(`${file} contains ${label}`);
  }
}

// 3f. Nothing unexpected was staged
const allowed = (f) => RUNTIME_FILES.includes(f) || RUNTIME_DIRS.some((d) => f.startsWith(d + path.sep));
const extras = staged.filter((f) => !allowed(f));
if (extras.length) fail(`unexpected files staged: ${extras.join(', ')}`);

// ---- 4. Zip it (manifest.json at the root of the archive) ------------------
try {
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store'], { cwd: STAGE, stdio: 'inherit' });
} catch (err) {
  fail('could not run the "zip" command. On Windows, zip the contents of dist/unpacked by hand.');
}

const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(0);
console.log(`✔ Built dist/${zipName} (${sizeKb} KB, ${staged.length} files, version ${manifest.version})`);
console.log('  Staged copy for "Load unpacked" testing: dist/unpacked');
