'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const manifest = readJson('manifest.json');
const pkg = readJson('package.json');

if (manifest.version !== pkg.version) {
  throw new Error(`Version mismatch: manifest=${manifest.version}, package=${pkg.version}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`Expected a three-part numeric version, got ${manifest.version}`);
}
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${manifest.version}`) {
  throw new Error(`Tag ${process.env.RELEASE_TAG} does not match v${manifest.version}`);
}

// Only versioned project sources: never inspect local browser profiles or exports.
const files = execFileSync('git', ['ls-files', '-z', '--', '*.js'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);
if (!files.length) throw new Error('No tracked JavaScript files found');
for (const file of files) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], {
    cwd: root, stdio: 'inherit',
  });
}
console.log(`Version ${manifest.version}; syntax OK for ${files.length} JavaScript files`);
