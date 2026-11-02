import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { create } from "tar";

const run = promisify(execFile);
const client = fileURLToPath(new URL("index.ts", import.meta.url));

for (const description of ["ASCII config", "Config with an en dash – preserved"]) {
  test(`push CLI preserves config bytes: ${description}`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "registry-upload-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = Buffer.from(JSON.stringify({ config: { Labels: { description } } }));
    const digest = `sha256:${createHash("sha256").update(config).digest("hex")}`;
    await writeFile(path.join(root, "config.json"), config);
    await writeFile(path.join(root, "manifest.json"), JSON.stringify([{ Config: "config.json", Layers: [] }]));
    const archive = path.join(root, "image.tar");
    await create({ file: archive, cwd: root }, ["config.json", "manifest.json"]);
    const bin = path.join(root, "bin");
    await mkdir(bin);
    // Only Docker's export is replaced; the real CLI reads, hashes and uploads the archive.
    await writeFile(
      path.join(bin, "docker"),
      '#!/bin/sh\ncase "$1" in\nimages) echo fixture;;\nsave) cp "$PUSH_TEST_ARCHIVE" "$4";;\n*) exit 1;;\nesac\n',
      { mode: 0o755 },
    );

    let uploaded;
    let contentLength;
    let manifest;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "HEAD") {
        res.writeHead(404).end();
      } else if (req.method === "POST") {
        res.writeHead(202, { "Docker-Upload-UUID": "fixture", "Location": "/v2/fixture/blobs/uploads/fixture" }).end();
      } else if (req.method === "PATCH") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        uploaded = Buffer.concat(chunks);
        contentLength = Number(req.headers["content-length"]);
        res.writeHead(202, { Range: req.headers.range }).end();
      } else if (req.method === "PUT" && url.pathname.includes("/blobs/")) {
        const actualDigest = `sha256:${createHash("sha256").update(uploaded).digest("hex")}`;
        res.writeHead(actualDigest === url.searchParams.get("digest") ? 201 : 400).end("DIGEST_INVALID");
      } else if (req.method === "PUT" && url.pathname.includes("/manifests/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        manifest = JSON.parse(Buffer.concat(chunks));
        res.writeHead(201).end();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        }),
    );

    let failure;
    try {
      const push = run("bun", ["run", client, `127.0.0.1:${server.address().port}/fixture:utf8`], {
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          PUSH_TEST_ARCHIVE: archive,
          TMPDIR: root,
          USERNAME_REGISTRY: "fixture",
          SKIP_AUTH: "true",
          INSECURE_HTTP_PUSH: "true",
          MAX_RETRIES: "1",
        },
      });
      push.child.stdin.end();
      await push;
    } catch (error) {
      failure = error;
    }
    assert.equal(contentLength, config.length, "Content-Length must count UTF-8 bytes");
    assert.deepEqual(uploaded, config, "config upload must preserve every byte");
    assert.equal(failure, undefined, failure?.stderr);
    assert.equal(manifest.config.size, config.length);
    assert.equal(manifest.config.digest, digest);
  });
}
