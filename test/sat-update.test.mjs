import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyTarballIntegrity, fetchLatestMeta } from "../server/sat-update.mjs";

const BUF = Buffer.from("orb44-tarball-bytes");

function sri(alg, buf = BUF) {
  return `${alg}-${crypto.createHash(alg).update(buf).digest("base64")}`;
}

test("verifyTarballIntegrity accepts a valid sha512 SRI value", () => {
  assert.equal(verifyTarballIntegrity(BUF, { integrity: sri("sha512") }), true);
});

test("verifyTarballIntegrity accepts a valid sha256 SRI value", () => {
  assert.equal(verifyTarballIntegrity(BUF, { integrity: sri("sha256") }), true);
});

test("verifyTarballIntegrity rejects malformed SRI with no separator", () => {
  assert.throws(() => verifyTarballIntegrity(BUF, { integrity: "not-a-real-sri-but-has-dashes" }), /tarball integrity/);
});

test("verifyTarballIntegrity rejects an SRI value with an empty digest", () => {
  assert.throws(() => verifyTarballIntegrity(BUF, { integrity: "sha512-" }), /tarball integrity/);
});

test("verifyTarballIntegrity rejects an unsupported algorithm without hashing", () => {
  // md5 is a real Node hash algorithm, so this only passes if the algorithm is
  // rejected by the allowlist rather than handed straight to crypto.createHash.
  assert.throws(() => verifyTarballIntegrity(BUF, { integrity: sri("md5") }), /tarball integrity missing/);
});

test("verifyTarballIntegrity rejects a digest mismatch", () => {
  const bad = sri("sha256").replace(/.$/, "0");
  assert.throws(() => verifyTarballIntegrity(BUF, { integrity: bad }), /tarball integrity mismatch/);
});

test("verifyTarballIntegrity falls back to dist.shasum when integrity is absent, case-insensitively", () => {
  const shasum = crypto.createHash("sha1").update(BUF).digest("hex").toUpperCase();
  assert.equal(verifyTarballIntegrity(BUF, { shasum }), true);
});

test("verifyTarballIntegrity rejects a shasum mismatch", () => {
  assert.throws(() => verifyTarballIntegrity(BUF, { shasum: "0".repeat(40) }), /tarball integrity mismatch/);
});

test("verifyTarballIntegrity rejects when neither integrity nor shasum is provided", () => {
  assert.throws(() => verifyTarballIntegrity(BUF, {}), /tarball integrity missing/);
});

function fakeFetch(json, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => json });
}

test("fetchLatestMeta returns integrity and shasum from the registry response", async () => {
  const meta = await fetchLatestMeta(
    fakeFetch({
      version: "1.2.3",
      dist: { tarball: "https://registry.npmjs.org/@orb44/cli/-/cli-1.2.3.tgz", integrity: sri("sha512"), shasum: "abc" },
    })
  );
  assert.equal(meta.version, "1.2.3");
  assert.equal(meta.integrity, sri("sha512"));
  assert.equal(meta.shasum, "abc");
});

test("fetchLatestMeta throws when the registry omits both integrity and shasum", async () => {
  await assert.rejects(
    fetchLatestMeta(fakeFetch({ version: "1.2.3", dist: { tarball: "https://registry.npmjs.org/@orb44/cli/-/cli-1.2.3.tgz" } })),
    /missing integrity/
  );
});
