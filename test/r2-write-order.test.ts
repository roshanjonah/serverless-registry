import { describe, expect, test } from "vitest";
import type { Env } from "..";
import { R2Registry } from "../src/registry/r2";

const imageManifestContentType = "application/vnd.oci.image.manifest.v1+json";

describe("manifest write ordering", () => {
  test("starts mutable tag and digest writes concurrently", async () => {
    const startedManifestWrites: string[] = [];
    let writesStartedBeforeFirstCompletion: string[] = [];
    let releaseWrites: () => void;
    const writesMayComplete = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    let releaseScheduled = false;
    const registry = {
      head: async () => null,
      put: async (key: string) => {
        if (key.includes("/manifests/")) {
          startedManifestWrites.push(key);
          if (!releaseScheduled) {
            releaseScheduled = true;
            queueMicrotask(() => {
              writesStartedBeforeFirstCompletion = [...startedManifestWrites];
              releaseWrites();
            });
          }
          await writesMayComplete;
        }
        return {};
      },
    } as unknown as R2Bucket;
    const env = { REGISTRY: registry } as Env;
    const manifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: imageManifestContentType,
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: `sha256:${"0".repeat(64)}`,
        size: 0,
      },
      layers: [],
    });

    const result = await new R2Registry(env).putManifestInner(
      "write-order",
      "latest",
      new Blob([manifest]).stream(),
      imageManifestContentType,
      false,
    );

    expect("response" in result).toBe(false);
    expect(writesStartedBeforeFirstCompletion).toEqual([
      expect.stringMatching(/\/manifests\/sha256:/),
      "write-order/manifests/latest",
    ]);
  });

  test("finishes the digest write before starting a protected tag write", async () => {
    const events: string[] = [];
    const tagKey = "protected-write-order/manifests/v1.2.3";
    const registry = {
      head: async () => null,
      put: async (key: string) => {
        if (key.includes("/manifests/")) {
          const kind = key === tagKey ? "tag" : "digest";
          events.push(`start:${kind}`);
          await Promise.resolve();
          events.push(`finish:${kind}`);
        }
        return {};
      },
    } as unknown as R2Bucket;
    const env = {
      REGISTRY: registry,
      IMMUTABLE_TAG_PATTERN: String.raw`v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`,
    } as Env;
    const manifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: imageManifestContentType,
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: `sha256:${"0".repeat(64)}`,
        size: 0,
      },
      layers: [],
    });

    const result = await new R2Registry(env).putManifestInner(
      "protected-write-order",
      "v1.2.3",
      new Blob([manifest]).stream(),
      imageManifestContentType,
      false,
    );

    expect("response" in result).toBe(false);
    expect(events).toEqual(["start:digest", "finish:digest", "start:tag", "finish:tag"]);
  });
});
