import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const LEGACY_EXTENSION_ID = "oifbnlabbgicinkclodpgpplhbkkdcnf";
const LEGACY_EXTENSION_NAME = "Mimo Floating Summary";
const DIST_ROOT = resolve("dist");
const DIST_MANIFEST = join(DIST_ROOT, "manifest.json");
const DIST_BACKGROUND = join(DIST_ROOT, "assets/background.js");
const CLICK_FIX_MARKER = "当前页面不支持注入";
const distManifest = readJson(DIST_MANIFEST);
const extensionNames = new Set([LEGACY_EXTENSION_NAME, distManifest?.name].filter(Boolean));

const browserRoots = [
  ["Chrome", join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/User Data")],
  ["Edge", join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/User Data")],
  ["Chromium", join(process.env.LOCALAPPDATA ?? "", "Chromium/User Data")]
].filter(([, root]) => existsSync(root));

if (!process.env.LOCALAPPDATA || browserRoots.length === 0) {
  fail("Chromium browser user data directory not found.");
}

const matches = [];

for (const [browser, userDataRoot] of browserRoots) {
  const profiles = readdirSync(userDataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
    .map((entry) => entry.name);

  for (const profile of profiles) {
    for (const fileName of ["Preferences", "Secure Preferences"]) {
      const prefPath = join(userDataRoot, profile, fileName);
      if (!existsSync(prefPath)) continue;

      const prefs = readJson(prefPath);
      const settings = prefs?.extensions?.settings ?? {};
      for (const [id, value] of Object.entries(settings)) {
        const installedPath = typeof value?.path === "string" ? resolve(value.path) : "";
        const manifestPath = installedPath ? join(installedPath, "manifest.json") : "";
        const installedManifest = manifestPath && existsSync(manifestPath) ? readJson(manifestPath) : undefined;
        const manifestName = value?.manifest?.name ?? installedManifest?.name;

        if (!isTargetExtension(id, manifestName, installedPath)) continue;

        matches.push({
          browser,
          profile,
          fileName,
          id,
          state: value?.state,
          location: value?.location,
          installedPath,
          manifestName,
          manifestVersion: value?.manifest?.version ?? installedManifest?.version,
          action: inspectAction(installedManifest),
          installedBackground: inspectBackground(join(installedPath, "assets/background.js")),
          distBackground: inspectBackground(DIST_BACKGROUND),
          installedAssets: inspectAssets(join(installedPath, "assets")),
          distAssets: inspectAssets(join(DIST_ROOT, "assets"))
        });
      }
    }
  }
}

if (matches.length === 0) {
  fail(
    `Chromium profiles do not list ${Array.from(extensionNames).join(" / ")} from ${DIST_ROOT}. Load dist/ through chrome://extensions first.`
  );
}

const normalized = matches.map((match) => ({
  ...match,
  backgroundMatchesDist:
    Boolean(match.installedBackground.sha256) &&
    Boolean(match.distBackground.sha256) &&
    match.installedBackground.sha256 === match.distBackground.sha256,
  assetsMatchDist: assetsMatch(match.installedAssets.hashes, match.distAssets.hashes),
  installedHasClickFix: match.installedAssets.hasClickFix,
  distHasClickFix: match.distAssets.hasClickFix
}));

console.log(JSON.stringify(normalized, null, 2));

const bad = normalized.filter(
  (match) =>
    !match.backgroundMatchesDist ||
    !match.assetsMatchDist ||
    match.action.hasPopup ||
    !match.installedHasClickFix ||
    !match.distHasClickFix
);

if (bad.length > 0) {
  process.exitCode = 2;
}

function isTargetExtension(id, manifestName, installedPath) {
  if (id === LEGACY_EXTENSION_ID) return true;
  if (manifestName && extensionNames.has(manifestName)) return true;
  if (installedPath && pathsEqual(installedPath, DIST_ROOT)) return true;
  return false;
}

function pathsEqual(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function inspectBackground(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      sha256: "",
      hasClickFix: false
    };
  }

  const content = readFileSync(filePath);
  const text = content.toString("utf8");
  return {
    path: filePath,
    exists: true,
    sha256: createHash("sha256").update(content).digest("hex"),
    hasClickFix: text.includes(CLICK_FIX_MARKER)
  };
}

function inspectAction(manifest) {
  const popupPath = manifest?.action?.default_popup;
  return {
    defaultTitle: manifest?.action?.default_title ?? "",
    popupPath: popupPath ?? "",
    hasPopup: typeof popupPath === "string" && popupPath.length > 0
  };
}

function inspectAssets(assetsPath) {
  if (!existsSync(assetsPath)) {
    return {
      path: assetsPath,
      exists: false,
      hashes: {},
      hasClickFix: false
    };
  }

  const hashes = {};
  let hasClickFix = false;
  for (const entry of readdirSync(assetsPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = join(assetsPath, entry.name);
    const content = readFileSync(filePath);
    hashes[entry.name] = createHash("sha256").update(content).digest("hex");
    if (content.toString("utf8").includes(CLICK_FIX_MARKER)) {
      hasClickFix = true;
    }
  }

  return {
    path: assetsPath,
    exists: true,
    hashes,
    hasClickFix
  };
}

function assetsMatch(installedHashes, distHashes) {
  const distEntries = Object.entries(distHashes);
  if (distEntries.length === 0) return false;
  return distEntries.every(([name, hash]) => installedHashes[name] === hash);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
