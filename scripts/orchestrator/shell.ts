import { spawn } from 'node:child_process';

export interface ShellRunOptions {
  cwd: string;
  /** Hard timeout in ms; default 5 minutes. */
  timeoutMs?: number;
  /** Environment overrides merged onto process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface ShellRunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Shell {
  run(command: string, opts: ShellRunOptions): Promise<ShellRunResult>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Live impl. Runs the command via `/bin/sh -c`. */
export class RealShell implements Shell {
  async run(
    command: string,
    opts: ShellRunOptions,
  ): Promise<ShellRunResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    return new Promise<ShellRunResult>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', command], {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf-8')));
      child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf-8')));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(`shell command timed out after ${timeoutMs}ms: ${command}`),
        );
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}

export type FakeShellResponse =
  | ShellRunResult
  | ((command: string, opts: ShellRunOptions) => ShellRunResult);

/** Scripted shell for tests. Records all invocations on `.calls`. */
export class FakeShell implements Shell {
  private queue: FakeShellResponse[];
  public readonly calls: Array<{ command: string; opts: ShellRunOptions }> = [];

  constructor(responses: FakeShellResponse[] = []) {
    this.queue = [...responses];
  }

  enqueue(r: FakeShellResponse): void {
    this.queue.push(r);
  }

  async run(
    command: string,
    opts: ShellRunOptions,
  ): Promise<ShellRunResult> {
    this.calls.push({ command, opts });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(
        `FakeShell: run() called for "${command}" but no scripted response left`,
      );
    }
    return typeof next === 'function' ? next(command, opts) : next;
  }
}

export function shellOk(stdout = ''): ShellRunResult {
  return { command: '(fake)', exitCode: 0, stdout, stderr: '', durationMs: 0 };
}

export function shellFail(stderr = 'fake error', exitCode = 1): ShellRunResult {
  return { command: '(fake)', exitCode, stdout: '', stderr, durationMs: 0 };
}
