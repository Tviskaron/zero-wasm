import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publishScript = fileURLToPath(new URL('../scripts/publish-pages.sh', import.meta.url));

test('publishes only build output, preserves source state, and updates Pages history', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'zero-wasm-publish-'));
  const source = path.join(temporary, 'source');
  const remote = path.join(temporary, 'remote.git');
  mkdirSync(source);
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const git = (...args) => run('git', args);
  const write = (file, content) => writeFileSync(path.join(source, file), content);
  const publish = () => run('bash', [publishScript]);

  try {
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Pages test');
    git('config', 'user.email', 'pages-test@example.invalid');
    git('remote', 'add', 'origin', remote);
    write('.gitignore', 'dist/\n');
    write('README.md', 'Source only\n');
    git('add', '.');
    git('commit', '-m', 'Source');
    const sourceCommit = git('rev-parse', 'HEAD');
    write('README.md', 'Staged source edit\n');
    git('add', 'README.md');
    const sourceState = git('status', '--porcelain');

    mkdirSync(path.join(source, 'dist'));
    write('dist/index.html', '<h1>First build</h1>');
    write('dist/.nojekyll', '');
    write('dist/old.js', '// old bundle');
    publish();
    const first = git('rev-parse', 'origin/gh-pages');
    assert.equal(git('ls-tree', '--name-only', first), '.nojekyll\nindex.html\nold.js');
    assert.equal(git('rev-list', '--parents', '-n', '1', first), first);

    write('dist/index.html', '<h1>Second build</h1>');
    rmSync(path.join(source, 'dist/old.js'));
    write('dist/new.js', '// replacement bundle');
    publish();
    const second = git('rev-parse', 'origin/gh-pages');
    assert.equal(git('rev-parse', `${second}^`), first);
    assert.equal(git('ls-tree', '--name-only', second), '.nojekyll\nindex.html\nnew.js');
    assert.equal(git('show', `${second}:index.html`), '<h1>Second build</h1>');
    publish();
    assert.equal(git('rev-parse', 'origin/gh-pages'), second);
    assert.equal(git('branch', '--show-current'), 'main');
    assert.equal(git('rev-parse', 'HEAD'), sourceCommit);
    assert.equal(git('status', '--porcelain'), sourceState);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
