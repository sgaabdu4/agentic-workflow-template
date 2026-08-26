#!/usr/bin/env node
/**
 * Runs one of the shared POSIX hook scripts through a real POSIX shell.
 *
 * Copilot CLI picks a hook handler by platform: `bash` on Unix, `powershell` on
 * Windows. A bash-only handler therefore has nothing to run on Windows, and
 * because preToolUse is fail-closed that denies every tool call with
 * "Denied by preToolUse hook (hook errored)". The Windows handlers point here
 * instead, so the shell is resolved in Node rather than assumed.
 *
 * Naming `bash` is not enough on Windows: System32\bash.exe is the WSL launcher
 * and shadows Git Bash on PATH, failing with execvpe(/bin/bash) when no distro
 * is installed. The resolution below mirrors resolvePosixShell() in
 * scripts/verify-agent-workflow.mjs, which is verified on Windows.
 *
 * stdio is inherited so the hook payload on stdin, any stdout JSON, and the exit
 * code all pass through unchanged — the hook contract depends on all three.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function resolvePosixShell() {
  if (process.platform !== "win32") return "bash";
  const candidates = [];
  const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  if (gitExecPath.status === 0) {
    // .../Git/mingw64/libexec/git-core -> .../Git/bin/bash.exe
    let dir = gitExecPath.stdout.trim();
    while (dir && path.dirname(dir) !== dir) {
      candidates.push(path.join(dir, "bin", "bash.exe"));
      dir = path.dirname(dir);
    }
  }
  for (const base of [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
  ]) {
    if (base) candidates.push(path.join(base, "Git", "bin", "bash.exe"));
  }
  const system32 = path
    .join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32")
    .toLowerCase();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved.toLowerCase().startsWith(system32)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return "bash";
}

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("run-posix.mjs: expected a script path");
  process.exit(1);
}

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
});
const base =
  root.status === 0 && root.stdout.trim()
    ? root.stdout.trim()
    : path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const target = path.isAbsolute(script) ? script : path.join(base, script);

const result = spawnSync(resolvePosixShell(), [target, ...rest], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
