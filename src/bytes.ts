import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";

export type FileSummary = { path: string; size: number; sha256: string };
export type Comparison = {
  local: FileSummary;
  deployed: FileSummary;
  byteEqual: boolean;
  match: boolean;
};

export async function summarizeFile(path: string): Promise<FileSummary> {
  const before = await stat(path);
  if (!before.isFile()) throw new Error(`Not a regular file: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`File changed while hashing: ${path}`);
  }
  return { path, size: after.size, sha256: hash.digest("hex") };
}

async function bytesEqual(leftPath: string, rightPath: string, size: number): Promise<boolean> {
  const left = await open(leftPath, "r");
  const right = await open(rightPath, "r");
  try {
    const a = Buffer.allocUnsafe(64 * 1024);
    const b = Buffer.allocUnsafe(64 * 1024);
    for (let offset = 0; offset < size; offset += a.length) {
      const count = Math.min(a.length, size - offset);
      const [readA, readB] = await Promise.all([
        left.read(a, 0, count, offset),
        right.read(b, 0, count, offset),
      ]);
      if (readA.bytesRead !== count || readB.bytesRead !== count) {
        throw new Error("File changed while comparing bytes");
      }
      if (!a.subarray(0, count).equals(b.subarray(0, count))) return false;
    }
    return true;
  } finally {
    await Promise.all([left.close(), right.close()]);
  }
}

export async function compareFiles(localPath: string, deployedPath: string): Promise<Comparison> {
  const [initialLocal, initialDeployed] = await Promise.all([
    stat(localPath),
    stat(deployedPath),
  ]);
  const [local, deployed] = await Promise.all([
    summarizeFile(localPath),
    summarizeFile(deployedPath),
  ]);
  const byteEqual =
    local.size === deployed.size &&
    (await bytesEqual(localPath, deployedPath, local.size));
  // Hashes and an actual byte comparison must agree. Recheck metadata after
  // comparing to catch ordinary concurrent writes to either input.
  const [localAfter, deployedAfter] = await Promise.all([
    stat(localPath),
    stat(deployedPath),
  ]);
  const stable = (before: typeof initialLocal, after: typeof initialLocal, size: number) =>
    before.isFile() && after.isFile() && before.size === size && after.size === size &&
    before.ino === after.ino && before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs;
  if (!stable(initialLocal, localAfter, local.size) ||
      !stable(initialDeployed, deployedAfter, deployed.size)) {
    throw new Error("File changed while comparing bytes");
  }
  return {
    local,
    deployed,
    byteEqual,
    match: byteEqual && local.sha256 === deployed.sha256,
  };
}
