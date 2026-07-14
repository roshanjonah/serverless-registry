import { describe, expect, test } from "vitest";
import { isImmutableTagReference, resolveImmutableTagPattern } from "../src/registry/tag-policy";

describe("immutable tag policy", () => {
  test("is disabled when the pattern is unset or empty", () => {
    expect(resolveImmutableTagPattern(undefined)).toBeNull();
    expect(resolveImmutableTagPattern("  ")).toBeNull();
  });

  test("matches the entire reference and excludes operational tags and prereleases", () => {
    const pattern = resolveImmutableTagPattern(String.raw`v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`);

    expect(isImmutableTagReference("v1.2.3", pattern)).toBe(true);
    expect(isImmutableTagReference("prefix-v1.2.3", pattern)).toBe(false);
    expect(isImmutableTagReference("v1.2.3-suffix", pattern)).toBe(false);
    expect(isImmutableTagReference("v1.2.3-rc.1", pattern)).toBe(false);
    expect(isImmutableTagReference("latest", pattern)).toBe(false);
  });

  test("never treats a content digest as a tag reference", () => {
    const pattern = resolveImmutableTagPattern(".*");
    expect(isImmutableTagReference(`sha256:${"a".repeat(64)}`, pattern)).toBe(false);
  });

  test("rejects an invalid configured expression", () => {
    expect(() => resolveImmutableTagPattern("[")).toThrow(/Invalid IMMUTABLE_TAG_PATTERN/);
  });
});
