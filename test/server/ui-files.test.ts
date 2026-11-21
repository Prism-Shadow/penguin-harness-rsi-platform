/**
 * The page's files (GET /api/rsi-workbench/ui/*).
 *
 * Given a built `ui/` folder with an index, an asset, and links pointing in and out of it:
 * - the index and the assets are served with their content types and revalidated on every load;
 * - a path that climbs out (`..`, encoded or not), a backslash, a folder, a missing file, or a
 *   link — to a file outside the folder or inside it — is a 404 and reveals nothing;
 * - nothing is served to a request that is not signed in (the host's sign-in runs first).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canCreateSymlink, createTestHost, tempRoot, type TestHost } from "../helpers/host.js";

const symlinks = await canCreateSymlink();

describe("the page's files", () => {
  let host: TestHost;
  let uiDir: string;
  let outside: string;

  beforeEach(async () => {
    const base = await tempRoot("rsi-ui-");
    uiDir = path.join(base, "ui");
    outside = path.join(base, "secret.txt");
    await fs.mkdir(path.join(uiDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(uiDir, "index.html"), "<!doctype html><title>x</title>");
    await fs.writeFile(path.join(uiDir, "assets", "index-abc.js"), "console.log(1)");
    await fs.writeFile(outside, "do not serve");
    host = await createTestHost({ uiDir });
  });
  afterEach(async () => {
    await host.dispose();
    await fs.rm(path.dirname(uiDir), { recursive: true, force: true });
  });

  it("serves the index and its assets, revalidated on every load", async () => {
    const index = await host.request("GET", "/api/rsi-workbench/ui/index.html");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(await index.text()).toContain("<title>x</title>");
    const asset = await host.request("GET", "/api/rsi-workbench/ui/assets/index-abc.js");
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect((await host.request("GET", "/api/rsi-workbench/ui")).status).toBe(200);
  });

  it("refuses every path that leaves the folder or names no file", async () => {
    for (const url of [
      "/api/rsi-workbench/ui/../secret.txt",
      "/api/rsi-workbench/ui/assets/%2E%2E/%2E%2E/secret.txt",
      "/api/rsi-workbench/ui/assets%2F..%2F..%2Fsecret.txt",
      "/api/rsi-workbench/ui/assets%5Cindex-abc.js",
      "/api/rsi-workbench/ui/assets",
      "/api/rsi-workbench/ui/missing.js",
    ]) {
      const res = await host.request("GET", url);
      expect(res.status, url).toBe(404);
      expect(await res.text(), url).not.toContain("do not serve");
    }
  });

  it.skipIf(!symlinks)(
    "refuses a link, whether it points out of the folder or inside it",
    async () => {
      await fs.symlink(outside, path.join(uiDir, "leak.txt"));
      await fs.symlink(path.join(uiDir, "index.html"), path.join(uiDir, "alias.html"));
      await fs.symlink(path.join(uiDir, "assets"), path.join(uiDir, "linked"));
      for (const rel of ["leak.txt", "alias.html", "linked/index-abc.js"]) {
        const res = await host.request("GET", `/api/rsi-workbench/ui/${rel}`);
        expect(res.status, rel).toBe(404);
      }
    },
  );

  it.skipIf(!symlinks)("serves a folder that itself lies below a link", async () => {
    const linkedRoot = path.join(path.dirname(uiDir), "ui-link");
    await fs.symlink(uiDir, linkedRoot);
    await host.dispose();
    host = await createTestHost({ uiDir: linkedRoot });
    expect((await host.request("GET", "/api/rsi-workbench/ui/assets/index-abc.js")).status).toBe(
      200,
    );
  });

  it("serves nothing to a request that is not signed in", async () => {
    const res = await host.app.request("/api/rsi-workbench/ui/index.html");
    expect(res.status).toBe(401);
  });
});
