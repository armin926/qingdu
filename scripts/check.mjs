import { readFile, access, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.host_permissions, undefined);
assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons)]) await access(new URL(path, root));
for (const name of await readdir(new URL("src/", root))) {
  if (!name.endsWith(".js")) continue;
  const path = new URL(`src/${name}`, root);
  const checked = spawnSync(process.execPath, ["--check", path.pathname], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const source = await readFile(path, "utf8");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new WebSocket|https:\/\//.test(source), `Runtime network call in ${name}`);
}
console.log("Manifest, runtime paths, JavaScript syntax and no-network policy checked.");
