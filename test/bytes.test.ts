import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareFiles, summarizeFile } from "../src/bytes.js";
import { parseArgs, run, validPublicKey } from "../src/cli.js";

test("known SHA-256 vector and identical bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spbv-test-"));
  try {
    const a = join(dir, "a.so"), b = join(dir, "b.so");
    await Promise.all([writeFile(a, "abc"), writeFile(b, "abc")]);
    const result = await compareFiles(a, b);
    assert.equal(result.local.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(result.local.sha256, createHash("sha256").update("abc").digest("hex"));
    assert.equal(result.local.size, 3);
    assert.equal(result.match, true);
    assert.equal(result.byteEqual, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("one-byte difference and size difference both fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spbv-test-"));
  try {
    const a = join(dir, "a.so"), b = join(dir, "b.so");
    await writeFile(a, Buffer.from([1, 2, 3]));
    await writeFile(b, Buffer.from([1, 2, 4]));
    assert.equal((await compareFiles(a, b)).match, false);
    await writeFile(b, Buffer.from([1, 2]));
    const result = await compareFiles(a, b);
    assert.equal(result.match, false);
    assert.equal(result.byteEqual, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("missing file is an error", async () => {
  await assert.rejects(summarizeFile(join(tmpdir(), "spbv-definitely-missing.so")));
});

test("parser rejects malformed addresses and accepts a 32-byte base58 address", () => {
  assert.equal(validPublicKey("1".repeat(32)), true);
  assert.equal(validPublicKey("0".repeat(32)), false);
  assert.throws(() => parseArgs(["dump-and-compare", "--local", "a", "--program", "bad", "--url", "https://example.com"]));
  assert.throws(() => parseArgs(["compare", "--local", "a"]));
});

test("CLI reports mismatch with exit 1 and dump output is cleaned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spbv-test-"));
  try {
    const local = join(dir, "local.so");
    await writeFile(local, "one");
    const lines: string[] = [];
    let dumped = "";
    const code = await run(
      ["dump-and-compare", "--local", local, "--program", "1".repeat(32), "--url", "https://example.com"],
      { out: line => lines.push(line), error: line => lines.push(line) },
      async (_program, _url, output) => { dumped = output; await writeFile(output, "two"); },
    );
    assert.equal(code, 1);
    assert.match(lines.join("\n"), /MISMATCH/);
    await assert.rejects(summarizeFile(dumped));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
