import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
const files = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
    "ls-files",
    "-z",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const failures = [];
for (const file of files) {
  if (
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".example")) ||
    /service[-_]account.*\.json$/i.test(file)
  )
    failures.push(`${file}: private configuration must not be tracked`);
  if (!/\.(?:ts|tsx|js|mjs|json|md|example)$/.test(file)) continue;
  const source = readFileSync(path.resolve(file), "utf8");
  if (
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source) ||
    /AIza[0-9A-Za-z_-]{35}/.test(source)
  )
    failures.push(`${file}: possible embedded credential`);
  if (
    /NEXT_PUBLIC_(?:GEMINI|GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_ADMIN|ADMIN_SIGNUP_CODE)/.test(
      source,
    )
  )
    failures.push(`${file}: private credential configured as public`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Secret checks passed for ${files.length} tracked files.`);
