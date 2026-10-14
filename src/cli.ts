#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareFiles, summarizeFile } from "./bytes.js";

const usage = `Usage:
  spbv local <program.so>
  spbv compare --local <program.so> --deployed <dump.so>
  spbv dump-and-compare --program <PUBLIC_ADDRESS> --url <RPC_URL> --local <program.so> [--keep]

Exit 0 on a byte match; exit 1 on mismatch; exit 2 on input or runtime error.
--keep retains the downloaded dump in a unique temporary directory.`;

export type Command =
  | { action: "help" }
  | { action: "local"; path: string }
  | { action: "compare"; local: string; deployed: string }
  | { action: "dump-and-compare"; local: string; program: string; url: string; keep: boolean };

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function validPublicKey(value: string): boolean {
  if (!value || [...value].some(char => !alphabet.includes(char))) return false;
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  let bytes = number === 0n ? 0 : Math.ceil(number.toString(16).length / 2);
  for (const char of value) { if (char === "1") bytes++; else break; }
  return bytes === 32;
}

function rpcUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("RPC URL must be HTTP(S), without embedded credentials or a fragment");
  }
  return url.toString();
}

function options(tokens: string[], allowed: string[], flags: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i];
    if (!allowed.includes(key) && !flags.includes(key)) throw new Error(`Unknown option: ${key}`);
    if (out.has(key)) throw new Error(`Duplicate option: ${key}`);
    if (flags.includes(key)) { out.set(key, "true"); continue; }
    const value = tokens[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    out.set(key, value);
  }
  return out;
}

export function parseArgs(args: string[]): Command {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { action: "help" };
  const [action, ...rest] = args;
  if (action === "local") {
    if (rest.length !== 1) throw new Error("local requires exactly one file");
    return { action, path: rest[0] };
  }
  if (action === "compare") {
    const o = options(rest, ["--local", "--deployed"]);
    if (!o.get("--local") || !o.get("--deployed")) throw new Error("compare requires --local and --deployed");
    return { action, local: o.get("--local")!, deployed: o.get("--deployed")! };
  }
  if (action === "dump-and-compare") {
    const o = options(rest, ["--local", "--program", "--url"], ["--keep"]);
    if (!o.get("--local") || !o.get("--program") || !o.get("--url")) {
      throw new Error("dump-and-compare requires --local, --program, and --url");
    }
    if (!validPublicKey(o.get("--program")!)) throw new Error("Program address is not a 32-byte base58 public key");
    return { action, local: o.get("--local")!, program: o.get("--program")!, url: rpcUrl(o.get("--url")!), keep: o.has("--keep") };
  }
  throw new Error(`Unknown command: ${action}`);
}

export async function dumpProgram(program: string, url: string, output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("solana", ["--url", url, "--commitment", "finalized", "program", "dump", program, output], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      signal: AbortSignal.timeout(120_000),
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`solana program dump failed (exit ${code}); check your RPC and Solana CLI installation`)));
  });
}

type Io = { out: (line: string) => void; error: (line: string) => void };
export async function run(
  args: string[],
  io: Io = { out: console.log, error: console.error },
  dumper: typeof dumpProgram = dumpProgram,
): Promise<number> {
  try {
    const command = parseArgs(args);
    if (command.action === "help") { io.out(usage); return 0; }
    if (command.action === "local") {
      const file = await summarizeFile(command.path);
      io.out(`local size: ${file.size} bytes\nlocal SHA-256: ${file.sha256}`);
      return 0;
    }
    async function report(local: string, deployed: string): Promise<number> {
      const result = await compareFiles(local, deployed);
      io.out(`local size: ${result.local.size} bytes\nlocal SHA-256: ${result.local.sha256}\ndeployed/dump size: ${result.deployed.size} bytes\ndeployed/dump SHA-256: ${result.deployed.sha256}\nbyte equality: ${result.byteEqual ? "YES" : "NO"}\n${result.match ? "MATCH" : "MISMATCH"}`);
      return result.match ? 0 : 1;
    }
    if (command.action === "compare") return report(command.local, command.deployed);
    const temporary = await mkdtemp(join(tmpdir(), "spbv-"));
    const output = join(temporary, "program-dump.so");
    try {
      await dumper(command.program, command.url, output);
      const result = await report(command.local, output);
      if (command.keep) io.out(`kept dump: ${output}`);
      return result;
    } finally {
      if (!command.keep) await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    io.error(`spbv: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await run(process.argv.slice(2));
}
