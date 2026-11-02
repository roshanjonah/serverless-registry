# Registry UTF-8 config upload

Parent: jonah-and-associates/cfc-whitelisting-app#3. Ops Watch approved the shared-client fix, public CLI regression and merge on green.

## Cause and change

The push client read the Docker config as a string, hashed its UTF-8 bytes, then used its JavaScript character length for the PATCH Content-Length and manifest size. One U+2013 adds two UTF-8 bytes beyond the character count. The registry received truncated JSON, rejected its checksum during the R2 copy, and returned 500.

Both original failed R2 objects independently established the cause: stored 5785/5784 bytes versus complete 5787/5786 bytes; appending the missing `}}` restored valid JSON and each exact expected SHA-256. Multipart completion succeeded; request and multipart limits were not involved.

`push/index.ts` now reads `new Uint8Array(await file(configManifest).arrayBuffer())`. Existing hash, stream, Content-Length and manifest size consumers use bytes without additional conversions. Canonical file API: https://bun.sh/docs/api/file-io.

## Validation

Public seam: execute the real Bun push CLI against a local HTTP registry fixture. Only Docker image lookup/export is replaced with a deterministic saved-image archive; no network client, config parser, limiter or hashing implementation is mocked.

- RED: `pnpm --dir push test` before the byte-read change. ASCII passed; en-dash fixture failed `Content-Length must count UTF-8 bytes`, `74 !== 76`.
- GREEN: same command after the one-line change: 4 tests passed, 0 failed, 0 skipped. Checks exact uploaded bytes, matching SHA-256 and manifest config byte size; ASCII is the adjacent boundary.
- Existing two workspace cleanup cases retained. No tests removed.
- CI installs Bun 1.4.2 and the push directory's frozen lockfile so the public CLI regression runs in both Node matrix jobs.
- Raw local receipts: `.claude/artifacts/cfc-whitelisting-03/utf8-red.log` and `utf8-green.log` in registry MAIN.

No Worker deployment, production database write or CFC release push occurs in this PR. Rollback: revert this source commit. The CFC tag remains v0.1.0 at 299fe811fd8032df2edb2e54529e68cdbef8cbd7.

Parked: `src/router.ts:651` maps digest mismatch to generic 500 instead of OCI 400 DIGEST_INVALID; separate task, no Worker deployment here.
