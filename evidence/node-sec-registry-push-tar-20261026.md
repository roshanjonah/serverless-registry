# Registry uploader tar security patch

Updates the local Docker-image uploader from tar 7.4.3 to 7.5.22, retaining its Bun binary lock. The production Registry Worker and its dependencies are unchanged.

`push/index.ts:4,79` imports `extract` and unpacks the Docker-save archive. [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) affects tar <=7.5.18; the first patched release is 7.5.19. Official npm metadata confirms 7.5.22 retains Node >=18 compatibility. This dependency path does not establish attacker-controlled archive input or Worker exposure.

Canonical update: Bun 1.4.2 `bun update --config=<local-bunfig> --ignore-scripts 'tar@^7.5.21'`, with documented `install.saveTextLockfile=false`. Resolution selected 7.5.22. Decoded lock comparison shows tar/minizlib changes and removal of their obsolete transitive packages; unrelated retained package versions are unchanged. No lock-format migration, override or audit exception.

Validation at base 044b8c4c5606db5fc657efef70164abf4d42bbbe plus this dependency diff:

- `node --test workspace.node-test.mjs`: 2 passed, 0 failed/skipped; existing tests unchanged.
- Offline Bun smoke: installed tar version 7.5.22, `extract` export available, official `list` API parses a Git-produced archive successfully. This is parser/import coverage, not an authenticated upload or extraction journey.
- `bun audit --json`: `{}`, exit 0; no ignored findings.
- `git diff --check`: exit 0.
- Native PR/push workflow remains unchanged: root frozen install, typecheck and unit tests on Node 18.x/20.x. It does not exercise the uploader itself.

Raw logs: session `.claude/artifacts/node-sec/registry-push-{existing-tests,tar-smoke,audit-after,tar-update-corrected}-20261026.*`; decoded locks `registry-push-lock-{before,after}.txt`.

Rollback: revert this source change and restore its previous binary lock/dependency installation. No Worker publication, deployment, credentials, runtime replacement or restart belongs to this patch. The canonical local checkout contains pre-existing staged uploader edits; its activation must preserve and reconcile those edits rather than overwrite them.

Parked: root tooling security/compatibility holds, original Worker source binding and canonical local activation. Initial update used space-separated `--config`, which Bun parsed as a package path; no tracked files changed. The corrected documented equals form succeeded.
