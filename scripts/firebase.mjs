import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const env = { ...process.env };
// Prefer a project-local portable JDK on Windows when present.
const javaRoot = path.resolve(".tools/java");
if (process.platform === "win32" && existsSync(javaRoot)) {
  const jdk = readdirSync(javaRoot).find((name) => name.startsWith("jdk-21"));
  if (jdk) {
    env.JAVA_HOME = path.join(javaRoot, jdk);
    const pathKey =
      Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
    env[pathKey] =
      `${path.join(env.JAVA_HOME, "bin")}${path.delimiter}${env[pathKey] || ""}`;
  }
}
const child = spawn(
  process.execPath,
  [
    require.resolve("firebase-tools/lib/bin/firebase.js"),
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
