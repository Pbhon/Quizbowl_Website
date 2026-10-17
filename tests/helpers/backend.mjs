import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadBackend(filename, mocks = {}, globals = {}) {
  const modules = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const mod = { exports: {} };
    modules.set(absolute, mod);
    vm.runInNewContext(
      ts.transpileModule(readFileSync(absolute, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        require: (id) => {
          if (id in mocks) return mocks[id];
          if (id === "server-only") return {};
          if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
          if (id.startsWith("."))
            return load(path.resolve(path.dirname(absolute), `${id}.ts`));
          return require(id);
        },
        Request,
        Response,
        Headers,
        URL,
        URLSearchParams,
        Buffer,
        AbortSignal,
        TextDecoder,
        Date,
        setTimeout,
        clearTimeout,
        structuredClone,
        fetch: (...args) => fetch(...args),
        process: { env: {} },
        ...globals,
      },
    );
    return mod.exports;
  }
  return load(filename);
}
