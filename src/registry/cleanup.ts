// Tag-retention + GC orchestration for the scheduled() handler.
//
// Policy: per repository, keep the N highest-precedence semver tags (default 3)
// plus every non-semver tag (e.g. `latest`, branch names). Delete only the
// surplus *tag pointers* — the digest manifest stays in place until untagged
// GC reaps it, which keeps the operation crash-safe (a half-finished run can
// be re-run with no data loss).
//
// After tag pruning, untagged-mode GC runs per repository to delete orphan
// manifests, their referrer indexes, and any blobs that nothing pins.

import { Env } from "../..";
import { GarbageCollectionMode } from "./garbage-collector";

export const DEFAULT_RETENTION_COUNT = 3;
export const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export type SemverParsed = {
  tag: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

export type CleanupOptions = {
  retentionCount: number;
  dryRun: boolean;
};

export type RepositoryCleanupResult = {
  repository: string;
  tagsTotal: number;
  semverKept: string[];
  nonSemverKept: string[];
  tagsDeleted: string[];
  gcRan: boolean;
  error?: string;
};

export type CleanupSummary = {
  startedAt: string;
  finishedAt: string;
  retentionCount: number;
  dryRun: boolean;
  repositories: RepositoryCleanupResult[];
};

export function parseSemverTag(tag: string): SemverParsed | null {
  const match = SEMVER_REGEX.exec(tag);
  if (match === null) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    tag,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
}

// Compares semver entries per the precedence rules in semver.org §11:
// numeric major.minor.patch first, then a prerelease beats no-prerelease (lower
// precedence), then prerelease identifiers compared dot-by-dot. Returns the
// usual <0 / 0 / >0.
export function compareSemver(a: SemverParsed, b: SemverParsed): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePrereleaseIdentifier(aParts[i], bParts[i]);
    if (cmp !== 0) return cmp;
  }
  return aParts.length - bParts.length;
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aIsNum = /^\d+$/.test(a);
  const bIsNum = /^\d+$/.test(b);
  if (aIsNum && bIsNum) return Number(a) - Number(b);
  // numeric identifiers always have lower precedence than alphanumeric (semver §11.4.3)
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export type TagSelection = {
  keepSemver: string[];
  keepNonSemver: string[];
  deleteSemver: string[];
};

export function selectTagsToDelete(tags: string[], retentionCount: number): TagSelection {
  const semver: SemverParsed[] = [];
  const nonSemver: string[] = [];
  for (const tag of tags) {
    const parsed = parseSemverTag(tag);
    if (parsed === null) {
      nonSemver.push(tag);
    } else {
      semver.push(parsed);
    }
  }
  // Highest precedence first.
  semver.sort((a, b) => compareSemver(b, a));
  const keepSemver = semver.slice(0, retentionCount).map((s) => s.tag);
  const deleteSemver = semver.slice(retentionCount).map((s) => s.tag);
  return { keepSemver, keepNonSemver: nonSemver, deleteSemver };
}

// Lists every tag for a repository by walking the manifests/ prefix and
// dropping the `sha256:` digest entries — those are content-addressed pointers,
// not tags. Paginates until the listing is exhausted so we never silently
// truncate at 1k tags.
async function listAllTags(env: Env, repository: string): Promise<string[]> {
  const tags: string[] = [];
  const prefix = `${repository}/manifests/`;
  let cursor: string | undefined;
  do {
    const listed = await env.REGISTRY.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      const name = obj.key.slice(prefix.length);
      if (name.startsWith("sha256:")) continue;
      tags.push(name);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return tags;
}

async function listAllRepositories(env: Env): Promise<string[]> {
  const repos: string[] = [];
  let last: string | undefined;
  for (;;) {
    const result = await env.REGISTRY_CLIENT.listRepositories(1000, last);
    if ("response" in result) {
      throw new Error(`listRepositories failed: ${result.response.status}`);
    }
    repos.push(...result.repositories);
    if (result.cursor === undefined || result.cursor === "" || result.repositories.length === 0) break;
    last = result.cursor;
  }
  return repos;
}

export async function cleanupRepository(
  env: Env,
  repository: string,
  options: CleanupOptions,
): Promise<RepositoryCleanupResult> {
  const tags = await listAllTags(env, repository);
  const selection = selectTagsToDelete(tags, options.retentionCount);

  const result: RepositoryCleanupResult = {
    repository,
    tagsTotal: tags.length,
    semverKept: selection.keepSemver,
    nonSemverKept: selection.keepNonSemver,
    tagsDeleted: [],
    gcRan: false,
  };

  if (selection.deleteSemver.length === 0) {
    return result;
  }

  if (options.dryRun) {
    result.tagsDeleted = selection.deleteSemver;
    return result;
  }

  // Delete tag pointers in batches; the digest manifest stays until untagged GC.
  // Batch size of 100 keeps each delete() call well under the 1000-key R2 limit
  // while still amortising the round-trip cost.
  const batchSize = 100;
  for (let i = 0; i < selection.deleteSemver.length; i += batchSize) {
    const slice = selection.deleteSemver.slice(i, i + batchSize);
    const keys = slice.map((t) => `${repository}/manifests/${t}`);
    await env.REGISTRY.delete(keys);
    result.tagsDeleted.push(...slice);
  }

  const gcMode: GarbageCollectionMode = "untagged";
  try {
    await env.REGISTRY_CLIENT.garbageCollection(repository, gcMode);
    result.gcRan = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

export async function cleanupAllRepositories(env: Env, options: CleanupOptions): Promise<CleanupSummary> {
  const startedAt = new Date().toISOString();
  const repositories = await listAllRepositories(env);

  const results: RepositoryCleanupResult[] = [];
  for (const repo of repositories) {
    try {
      results.push(await cleanupRepository(env, repo, options));
    } catch (err) {
      results.push({
        repository: repo,
        tagsTotal: 0,
        semverKept: [],
        nonSemverKept: [],
        tagsDeleted: [],
        gcRan: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    retentionCount: options.retentionCount,
    dryRun: options.dryRun,
    repositories: results,
  };
}

export function resolveCleanupOptions(env: Env): CleanupOptions {
  const retentionCount = Number(env.RETENTION_COUNT ?? DEFAULT_RETENTION_COUNT);
  const dryRun = String(env.RETENTION_DRY_RUN ?? "false").toLowerCase() === "true";
  return {
    retentionCount: Number.isFinite(retentionCount) && retentionCount >= 1 ? retentionCount : DEFAULT_RETENTION_COUNT,
    dryRun,
  };
}
