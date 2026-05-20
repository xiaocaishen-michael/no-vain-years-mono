import { describe, expect, it } from 'vitest';
import { FakeShell, RealShell, shellOk, shellFail } from './shell.js';

describe('FakeShell', () => {
  it('records each command + opts in order', async () => {
    const sh = new FakeShell([shellOk('first'), shellOk('second')]);
    await sh.run('echo a', { cwd: '/x' });
    await sh.run('echo b', { cwd: '/y' });
    expect(sh.calls).toEqual([
      { command: 'echo a', opts: { cwd: '/x' } },
      { command: 'echo b', opts: { cwd: '/y' } },
    ]);
  });

  it('returns enqueued responses in order', async () => {
    const sh = new FakeShell([shellOk('one'), shellFail('two-err', 2)]);
    const r1 = await sh.run('c1', { cwd: '/' });
    const r2 = await sh.run('c2', { cwd: '/' });
    expect(r1.stdout).toBe('one');
    expect(r2.exitCode).toBe(2);
    expect(r2.stderr).toBe('two-err');
  });

  it('supports function responses for assertion on command shape', async () => {
    const sh = new FakeShell([
      (cmd, opts) => ({
        command: cmd,
        exitCode: 0,
        stdout: `ran "${cmd}" in ${opts.cwd}`,
        stderr: '',
        durationMs: 0,
      }),
    ]);
    const r = await sh.run('whoami', { cwd: '/tmp' });
    expect(r.stdout).toBe('ran "whoami" in /tmp');
  });

  it('throws when queue exhausted', async () => {
    const sh = new FakeShell();
    await expect(sh.run('x', { cwd: '/' })).rejects.toThrow(/no scripted response/);
  });
});

describe('RealShell', () => {
  it('returns exit 0 + stdout for successful command', async () => {
    const sh = new RealShell();
    const r = await sh.run('echo hello', { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
  });

  it('returns non-zero exit code for failing command', async () => {
    const sh = new RealShell();
    const r = await sh.run('exit 7', { cwd: process.cwd() });
    expect(r.exitCode).toBe(7);
  });

  it('captures stderr separately from stdout', async () => {
    const sh = new RealShell();
    const r = await sh.run('echo out; echo err >&2', { cwd: process.cwd() });
    expect(r.stdout.trim()).toBe('out');
    expect(r.stderr.trim()).toBe('err');
  });

  it('respects cwd', async () => {
    const sh = new RealShell();
    // macOS symlinks /tmp → /private/tmp; pwd -P resolves the physical path.
    const r = await sh.run('pwd -P', { cwd: '/tmp' });
    expect(r.stdout.trim()).toMatch(/(^|\/)tmp$/);
  });
});
