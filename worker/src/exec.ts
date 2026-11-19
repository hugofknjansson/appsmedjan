import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell. Never rejects: a failure shows up as a non-zero code. */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout, stderr: stderr || (err && code === 1 ? String(err.message) : '') });
      },
    );
  });
}

export async function mustExec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const res = await exec(cmd, args, opts);
  if (res.code !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${(res.stderr || res.stdout).trim().slice(-600)}`);
  }
  return res.stdout;
}
