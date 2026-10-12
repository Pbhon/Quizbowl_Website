import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

function route(errorCode) {
  const compiledModule = { exports: {} },
    logged = [];
  const code = ts.transpileModule(
    readFileSync("src/app/api/auth/team-session/route.ts", "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    URL,
    Response,
    console: { error: (...args) => logged.push(args) },
    require: (id) => {
      if (id === "firebase-admin/firestore") return { FieldValue: {} };
      if (id === "@/lib/server/site-team")
        return { siteTeam: () => ({ id: "school", name: "School" }) };
      if (id === "@/lib/firebase/admin")
        return {
          getFirebaseAdmin: () => ({
            db: {},
            auth: {
              verifyIdToken: async (_token, checkRevoked) => {
                assert.equal(checkRevoked, true);
                throw Object.assign(new Error("Sensitive diagnostic details"), {
                  code: errorCode,
                });
              },
            },
          }),
        };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return { ...compiledModule.exports, logged };
}
const request = () =>
  new Request("http://localhost:3000/api/auth/team-session", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
test("school authentication distinguishes server credentials from invalid user sessions", async () => {
  for (const code of [
    "app/invalid-credential",
    "auth/internal-error",
    undefined,
  ]) {
    const handler = route(code);
    const response = await handler.POST(request());
    assert.equal(response.status, 503);
    assert.match(
      (await response.json()).message,
      /server's Firebase credentials/,
    );
    assert.deepEqual(handler.logged[0], [
      "School token verification failed:",
      code || "unknown",
    ]);
  }
  for (const code of [
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/invalid-id-token",
    "auth/argument-error",
    "auth/user-disabled",
    "auth/user-not-found",
  ]) {
    const response = await route(code).POST(request());
    assert.equal(response.status, 401);
    assert.equal(
      (await response.json()).message,
      "Your session expired. Sign in again.",
    );
  }
});
