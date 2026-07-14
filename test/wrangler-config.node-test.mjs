import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

  assert.match(output, /\bREGISTRY: r2-registry\b/);
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

test("CI validates the tracked Wrangler configuration without replacing it", () => {
  const repository = new URL("..", import.meta.url);
  const trackedConfig = execFileSync("git", ["ls-files", "--error-unmatch", "wrangler.toml"], {
    cwd: repository,
    encoding: "utf8",
  });
  const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

  assert.equal(trackedConfig.trim(), "wrangler.toml");
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /\bcp\s+wrangler\.toml\.example\s+wrangler\.toml\b/);
});

test("deployment guidance preserves the tracked Wrangler source of truth", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /tracked `wrangler\.toml` is the deployment source of truth/i);
  assert.match(
    readme,
    /For a fresh deployment, review and update `name`,\s+`routes`\/`workers_dev`, and `env\.production\.r2_buckets\[\]\.bucket_name` before deploying\./,
  );
  assert.match(
    readme,
    /```toml\n\[env\.production\]\nr2_buckets = \[\n  \{ binding = "REGISTRY", bucket_name = "r2-registry" \}\n\]\n```/,
  );
  assert.doesNotMatch(readme, /\bcp\s+wrangler\.toml\.example\s+wrangler\.toml\b/);
});
