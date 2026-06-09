const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const extensions = new Set([".html", ".js", ".css", ".json"]);
const ignoredDirs = new Set([".git", "node_modules", "data", "outputs"]);

const mojibakePatterns = [
  /[諛媛荑좉뚯踰씪移怨]/,
  /[곹곸꽭뺣낫됱긽섎웾꾧깅쒓]/,
  /[濡醫蹂寃留댄]/,
  /\?[^<>"'\n\r]{0,20}<\/(?:a|button|label|summary|h[1-6]|span|option)>/,
  /<\/(?:a|button|label|summary|h[1-6]|span|option)>/.source
];

const exactBrokenFragments = [
  "?/a>",
  "?/button>",
  "?/label>",
  "?/summary>",
  "?곹",
  "?됱",
  "?섎",
  "?꾧",
  "?깅",
  "?대?",
  "諛붾",
  "援щ",
  "濡쒓",
  "移댄"
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) return [];
      return walk(full);
    }
    return extensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

const findings = [];
for (const file of walk(root)) {
  if (path.relative(root, file) === path.join("scripts", "check-korean-text.js")) continue;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const hasBrokenFragment = exactBrokenFragments.some(fragment => line.includes(fragment));
    const hasMojibake = mojibakePatterns.slice(0, 3).some(pattern => pattern.test(line));
    const hasMalformedTag = /\?[^<>"'\n\r]{0,20}<\/(?:a|button|label|summary|h[1-6]|span|option)>/.test(line);
    if (hasBrokenFragment || hasMojibake || hasMalformedTag) {
      findings.push({
        file: path.relative(root, file),
        line: index + 1,
        text: line.trim()
      });
    }
  });
}

if (findings.length) {
  console.error("깨진 한글/태그 의심 문구가 발견되었습니다. 배포 전 수정하세요.");
  for (const finding of findings.slice(0, 80)) {
    console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  }
  if (findings.length > 80) console.error(`...and ${findings.length - 80} more`);
  process.exit(1);
}

console.log("Korean text check ok");
