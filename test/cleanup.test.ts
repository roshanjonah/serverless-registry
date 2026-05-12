import { describe, expect, test } from "vitest";
import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker, { type Env } from "..";
import { R2Registry } from "../src/registry/r2";
import {
  cleanupAllRepositories,
  cleanupRepository,
  compareSemver,
  parseSemverTag,
  resolveCleanupOptions,
  selectTagsToDelete,
} from "../src/registry/cleanup";

describe("parseSemverTag", () => {
  test("accepts plain and v-prefixed semver", () => {
    expect(parseSemverTag("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseSemverTag("v1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: null });
  });

  test("captures prerelease identifiers", () => {
    expect(parseSemverTag("v1.0.0-rc.1")).toMatchObject({ prerelease: "rc.1" });
    expect(parseSemverTag("0.4.9-alpha")).toMatchObject({ prerelease: "alpha" });
  });

  test("rejects non-semver tags", () => {
    expect(parseSemverTag("latest")).toBeNull();
    expect(parseSemverTag("main")).toBeNull();
    expect(parseSemverTag("v1.0")).toBeNull();
    expect(parseSemverTag("v1")).toBeNull();
    expect(parseSemverTag("sha256:abc")).toBeNull();
    expect(parseSemverTag("release-2024-01-01")).toBeNull();
  });
});

describe("compareSemver", () => {
  test("orders by major then minor then patch", () => {
    const a = parseSemverTag("v1.2.3")!;
    const b = parseSemverTag("v1.2.4")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
    expect(compareSemver(b, a)).toBeGreaterThan(0);
    const c = parseSemverTag("v2.0.0")!;
    expect(compareSemver(b, c)).toBeLessThan(0);
  });

  test("prerelease has lower precedence than the same release", () => {
    const release = parseSemverTag("v1.0.0")!;
    const pre = parseSemverTag("v1.0.0-rc.1")!;
    expect(compareSemver(pre, release)).toBeLessThan(0);
    expect(compareSemver(release, pre)).toBeGreaterThan(0);
  });

  test("numeric prerelease identifiers compared numerically", () => {
    const a = parseSemverTag("v1.0.0-rc.2")!;
    const b = parseSemverTag("v1.0.0-rc.10")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
  });

  test("numeric identifier ranks below alphanumeric of same prefix", () => {
    const a = parseSemverTag("v1.0.0-1")!;
    const b = parseSemverTag("v1.0.0-alpha")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
  });
});

describe("selectTagsToDelete", () => {
  test("keeps the highest N semver tags", () => {
    const tags = ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4"];
    const sel = selectTagsToDelete(tags, 3);
    expect(sel.keepSemver.sort()).toEqual(["v1.0.2", "v1.0.3", "v1.0.4"].sort());
    expect(sel.deleteSemver.sort()).toEqual(["v1.0.0", "v1.0.1"].sort());
    expect(sel.keepNonSemver).toEqual([]);
  });

  test("preserves all non-semver tags regardless of count", () => {
    const tags = ["latest", "main", "v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3"];
    const sel = selectTagsToDelete(tags, 2);
    expect(sel.keepNonSemver.sort()).toEqual(["latest", "main"]);
    expect(sel.keepSemver.sort()).toEqual(["v1.0.2", "v1.0.3"]);
    expect(sel.deleteSemver.sort()).toEqual(["v1.0.0", "v1.0.1"]);
  });

  test("never deletes when retention >= semver tag count", () => {
    const tags = ["v1.0.0", "v1.0.1"];
    expect(selectTagsToDelete(tags, 3).deleteSemver).toEqual([]);
    expect(selectTagsToDelete(tags, 2).deleteSemver).toEqual([]);
  });

  test("orders v1.2.41 above v1.2.10 (string-sort gotcha)", () => {
    const tags = ["v1.2.10", "v1.2.4", "v1.2.41", "v1.2.5"];
    const sel = selectTagsToDelete(tags, 2);
    expect(sel.keepSemver.sort()).toEqual(["v1.2.10", "v1.2.41"]);
    expect(sel.deleteSemver.sort()).toEqual(["v1.2.4", "v1.2.5"]);
  });

  test("retention=0 keeps non-semver, deletes all semver", () => {
    const tags = ["latest", "v1.0.0", "v2.0.0"];
    const sel = selectTagsToDelete(tags, 0);
    expect(sel.keepSemver).toEqual([]);
    expect(sel.keepNonSemver).toEqual(["latest"]);
    expect(sel.deleteSemver.sort()).toEqual(["v1.0.0", "v2.0.0"]);
  });
});

describe("resolveCleanupOptions", () => {
  test("uses defaults when env vars are unset", () => {
    const opts = resolveCleanupOptions({} as Env);
    expect(opts).toEqual({ retentionCount: 3, dryRun: false });
  });

  test("parses RETENTION_COUNT and RETENTION_DRY_RUN", () => {
    const opts = resolveCleanupOptions({ RETENTION_COUNT: "5", RETENTION_DRY_RUN: "true" } as unknown as Env);
    expect(opts).toEqual({ retentionCount: 5, dryRun: true });
  });

  test("rejects non-numeric or sub-1 retention values, falls back to default", () => {
    const opts = resolveCleanupOptions({ RETENTION_COUNT: "abc" } as unknown as Env);
    expect(opts.retentionCount).toBe(3);
    const opts2 = resolveCleanupOptions({ RETENTION_COUNT: "0" } as unknown as Env);
    expect(opts2.retentionCount).toBe(3);
  });
});

// --- Integration tests against the worker bindings -----------------------------

const dockerContentType = "application/vnd.docker.distribution.manifest.v2+json";
const credentials = `Basic ${btoa("hello:world")}`;

function authedRequest(method: string, path: string, body: BodyInit | null = null, headers: Record<string, string> = {}) {
  return new Request(`https://registry.com${path}`, {
    method,
    body,
    headers: { ...headers, Authorization: credentials },
  });
}

async function callWorker(req: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res as Response;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadBlob(name: string, payload: string): Promise<{ digest: string; size: number }> {
  const enc = new TextEncoder();
  const buf = enc.encode(payload);
  const digest = `sha256:${await sha256Hex(buf)}`;
  const start = await callWorker(authedRequest("POST", `/v2/${name}/blobs/uploads/`));
  expect(start.ok).toBeTruthy();
  const patchPath = start.headers.get("location")!;
  const patch = await callWorker(authedRequest("PATCH", patchPath, buf));
  expect(patch.ok).toBeTruthy();
  const finishLoc = patch.headers.get("location")!;
  const sep = finishLoc.includes("?") ? "&" : "?";
  const finish = await callWorker(authedRequest("PUT", `${finishLoc}${sep}digest=${encodeURIComponent(digest)}`));
  expect(finish.ok).toBeTruthy();
  return { digest, size: buf.length };
}

async function pushManifestWithTag(name: string, tag: string): Promise<void> {
  const layer = await uploadBlob(name, `layer-${name}-${tag}-${Math.random()}`);
  const config = await uploadBlob(name, `config-${name}-${tag}-${Math.random()}`);
  const manifest = {
    schemaVersion: 2,
    mediaType: dockerContentType,
    config: { mediaType: "application/vnd.docker.container.image.v1+json", size: config.size, digest: config.digest },
    layers: [{ mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip", size: layer.size, digest: layer.digest }],
  };
  const put = await callWorker(
    authedRequest("PUT", `/v2/${name}/manifests/${tag}`, JSON.stringify(manifest), { "Content-Type": dockerContentType }),
  );
  expect(put.ok).toBeTruthy();
}

async function listTagPointers(name: string): Promise<string[]> {
  const e = env as Env;
  const objs = await e.REGISTRY.list({ prefix: `${name}/manifests/` });
  return objs.objects.map((o) => o.key.slice(`${name}/manifests/`.length)).filter((k) => !k.startsWith("sha256:"));
}

describe("cleanupRepository (integration)", () => {
  test("dry run reports the deletion plan without deleting anything", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const name = "cleanup-dryrun";
    for (const t of ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4", "latest"]) {
      await pushManifestWithTag(name, t);
    }
    const before = await listTagPointers(name);
    expect(before.sort()).toEqual(["latest", "v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4"]);

    const result = await cleanupRepository(e, name, { retentionCount: 3, dryRun: true });
    expect(result.tagsDeleted.sort()).toEqual(["v1.0.0", "v1.0.1"]);
    expect(result.gcRan).toBe(false);

    const after = await listTagPointers(name);
    expect(after.sort()).toEqual(before.sort());
  });

  test("real run prunes excess tags and reclaims orphan blobs via GC", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const name = "cleanup-real";
    for (const t of ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4", "latest"]) {
      await pushManifestWithTag(name, t);
    }
    const blobsBefore = (await e.REGISTRY.list({ prefix: `${name}/blobs/` })).objects.length;

    const result = await cleanupRepository(e, name, { retentionCount: 3, dryRun: false });
    expect(result.tagsDeleted.sort()).toEqual(["v1.0.0", "v1.0.1"]);
    expect(result.gcRan).toBe(true);

    const remainingTags = await listTagPointers(name);
    expect(remainingTags.sort()).toEqual(["latest", "v1.0.2", "v1.0.3", "v1.0.4"]);

    const remainingDigestManifests = (await e.REGISTRY.list({ prefix: `${name}/manifests/sha256:` })).objects.length;
    // 4 surviving tags → 4 distinct digest manifests.
    expect(remainingDigestManifests).toBe(4);

    const blobsAfter = (await e.REGISTRY.list({ prefix: `${name}/blobs/` })).objects.length;
    // Each pushed manifest contributes 2 blobs (layer + config). Two manifests
    // dropped → expect 4 fewer blobs.
    expect(blobsAfter).toBe(blobsBefore - 4);
  });

  test("repo with <= retention semver tags is untouched", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const name = "cleanup-noop";
    for (const t of ["v1.0.0", "v1.0.1", "latest"]) {
      await pushManifestWithTag(name, t);
    }
    const result = await cleanupRepository(e, name, { retentionCount: 3, dryRun: false });
    expect(result.tagsDeleted).toEqual([]);
    expect(result.gcRan).toBe(false);
  });
});

describe("scheduled() handler", () => {
  test("walks every repo and respects dry-run", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    e.RETENTION_COUNT = "2";
    e.RETENTION_DRY_RUN = "true";
    const a = "scheduled-a";
    const b = "scheduled-b";
    for (const t of ["v1.0.0", "v1.0.1", "v1.0.2"]) await pushManifestWithTag(a, t);
    for (const t of ["v2.0.0", "v2.0.1"]) await pushManifestWithTag(b, t);

    const summary = await cleanupAllRepositories(e, resolveCleanupOptions(e));
    const repoA = summary.repositories.find((r) => r.repository === a)!;
    const repoB = summary.repositories.find((r) => r.repository === b)!;
    expect(repoA.tagsDeleted.sort()).toEqual(["v1.0.0"]);
    expect(repoB.tagsDeleted).toEqual([]);

    // dry-run: tag pointers untouched
    const aTags = await listTagPointers(a);
    expect(aTags.sort()).toEqual(["v1.0.0", "v1.0.1", "v1.0.2"]);
  });

  test("invokes via scheduled() entrypoint with mock controller", async () => {
    const e = env as Env;
    e.RETENTION_COUNT = "3";
    e.RETENTION_DRY_RUN = "true";
    const ctrl = createScheduledController({ scheduledTime: new Date(0), cron: "0 16 * * SUN" });
    const ctx = createExecutionContext();
    await worker.scheduled!(ctrl, e, ctx);
    await waitOnExecutionContext(ctx);
    // No assertion beyond "did not throw" — the per-repo behaviour is covered
    // by the tests above. This proves the entrypoint glue is wired correctly.
  });
});

describe("POST /v2/_cleanup", () => {
  test("returns dry-run summary when dry_run=true override", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const name = "endpoint-dryrun";
    for (const t of ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3"]) {
      await pushManifestWithTag(name, t);
    }
    const res = await callWorker(authedRequest("POST", `/v2/_cleanup?dry_run=true&retention=2&repo=${name}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repository: string;
      tagsDeleted: string[];
      gcRan: boolean;
    };
    expect(body.repository).toBe(name);
    expect(body.tagsDeleted.sort()).toEqual(["v1.0.0", "v1.0.1"]);
    expect(body.gcRan).toBe(false);
    // Pointers untouched in dry run.
    expect((await listTagPointers(name)).sort()).toEqual(["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3"]);
  });

  test("real run via endpoint deletes tags and runs GC", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const name = "endpoint-real";
    for (const t of ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3"]) {
      await pushManifestWithTag(name, t);
    }
    const res = await callWorker(authedRequest("POST", `/v2/_cleanup?dry_run=false&retention=2&repo=${name}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tagsDeleted: string[]; gcRan: boolean };
    expect(body.tagsDeleted.sort()).toEqual(["v1.0.0", "v1.0.1"]);
    expect(body.gcRan).toBe(true);
    expect((await listTagPointers(name)).sort()).toEqual(["v1.0.2", "v1.0.3"]);
  });

  test("without ?repo runs across all repositories", async () => {
    const e = env as Env;
    e.REGISTRY_CLIENT = new R2Registry(e);
    const res = await callWorker(authedRequest("POST", `/v2/_cleanup?dry_run=true&retention=10`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dryRun: boolean; retentionCount: number; repositories: unknown[] };
    expect(body.dryRun).toBe(true);
    expect(body.retentionCount).toBe(10);
    expect(Array.isArray(body.repositories)).toBe(true);
  });
});
