# Solana Program Byte Verifier

A small CLI for checking a local Solana program binary against a downloaded deployed-program dump. It reports size and SHA-256 for both files **and compares their bytes**. It is useful when a successful build or deployment command is not enough evidence that two executable artifacts are identical.

## Install

Requires Node.js 20 or newer. The optional live dump command also requires the Solana CLI on your `PATH`.

```sh
npm install
npm run build
npm link
```

`npm link` makes the `spbv` command available locally. Without linking, run `node dist/src/cli.js`.

## Usage

```sh
spbv local ./program.so
spbv compare --local ./program.so --deployed ./program-dump.so
spbv dump-and-compare --program <PUBLIC_PROGRAM_ID> --url https://api.devnet.solana.com --local ./program.so
spbv dump-and-compare --program <PUBLIC_PROGRAM_ID> --url https://api.devnet.solana.com --local ./program.so --keep
```

`dump-and-compare` invokes `solana --url ... --commitment finalized program dump` without a shell. The downloaded file goes to a unique temporary directory and is deleted after comparison unless `--keep` is supplied. With `--keep`, the CLI prints its retained path. The `--url` option is required so a saved CLI default cannot silently select the wrong cluster. Validate the RPC/cluster yourself before treating a match as deployment provenance.

Example output:

```text
local size: 3 bytes
local SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
deployed/dump size: 3 bytes
deployed/dump SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
byte equality: YES
MATCH
```

Exit status is 0 for a match, 1 for a mismatch, and 2 for an input or runtime error. `local` exits 0 when it can read the file.

## Security model

This utility is read-only. It requires no wallet or keypair and never signs or submits a transaction. Never paste private keys into CLI arguments. Solana CLI and public RPC endpoints may impose rate limits. A dump reflects the program at the selected RPC and commitment; verify cluster genesis independently before relying on the result. Program bytes can change after the read if the program is upgradeable. The tool does not certify upgrade authority, source provenance, or future immutability.

## Development

```sh
npm run typecheck
npm test
npm run build
```

Unit tests use temporary local files and a fake dump function; no public network is required.

## License

MIT. See [LICENSE](LICENSE).
