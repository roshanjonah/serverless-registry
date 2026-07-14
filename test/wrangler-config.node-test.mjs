import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const wrangler = require.resolve("wrangler/bin/wrangler.js");

function resolvedBindings(environment) {
  return execFileSync(process.execPath, [wrangler, "deploy", "--env", environment, "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

test("development deployment does not publish plaintext registry credentials", () => {
  const output = resolvedBindings("dev");

  assert.doesNotMatch(output, /\b(?:READONLY_)?(?:USERNAME|PASSWORD):/);
});

test("production deployment does not publish authentication settings as plaintext vars", () => {
  const output = resolvedBindings("production");

  assert.doesNotMatch(
    output,
    /\b(?:JWT_REGISTRY_TOKENS_PUBLIC_KEY|READONLY_USERNAME|READONLY_PASSWORD|USERNAME|PASSWORD):/,
  );
});

test("local secret files are ignored for every Wrangler environment", () => {
  const ignored = execFileSync("git", ["check-ignore", ".dev.vars", ".dev.vars.dev", ".env", ".env.production"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  assert.deepEqual(ignored.trim().split("\n"), [".dev.vars", ".dev.vars.dev", ".env", ".env.production"]);
});
