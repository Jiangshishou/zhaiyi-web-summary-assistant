import { rm, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");
const manifest = JSON.parse(await readFile(resolve(distDir, "manifest.json"), "utf-8"));
const referencedIcons = new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {})
]);

for (const file of await readdir(resolve(distDir, "icons"))) {
  const iconPath = `icons/${file}`;
  if (!referencedIcons.has(iconPath)) {
    await rm(resolve(distDir, iconPath), { force: true });
  }
}
