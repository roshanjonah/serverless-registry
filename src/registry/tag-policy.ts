import { isValidDigest } from "../user";

export function resolveImmutableTagPattern(source: string | undefined): RegExp | null {
  const trimmed = source?.trim();
  if (!trimmed) return null;

  try {
    return new RegExp(`^(?:${trimmed})$`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid IMMUTABLE_TAG_PATTERN: ${detail}`);
  }
}

export function isImmutableTagReference(reference: string, pattern: RegExp | null): boolean {
  return pattern !== null && !isValidDigest(reference) && pattern.test(reference);
}
