import assert from "node:assert/strict";
export function memoryFirestore(initial, retryCallback = false) {
  const records = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const ref = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    where: (field, _operator, value) => ({ query: true, path, field, value }),
  });
  const snapshot = (ref) =>
    ref.query
      ? {
          docs: [...records]
            .filter(
              ([path, data]) =>
                path.startsWith(`${ref.path}/`) &&
                !path.slice(ref.path.length + 1).includes("/") &&
                data[ref.field] === ref.value,
            )
            .map(([path, data]) => ({
              id: path.split("/").at(-1),
              data: () => structuredClone(data),
            })),
        }
      : {
          exists: records.has(ref.path),
          data: () => structuredClone(records.get(ref.path)),
        };
  const getAll = async (...refs) => refs.map(snapshot);
  return {
    records,
    doc: ref,
    getAll,
    runTransaction: (callback) => {
      const run = queue.then(async () => {
        function transaction() {
          const writes = [];
          return {
            get: async (ref) => {
              assert.equal(writes.length, 0, "read before transaction writes");
              return snapshot(ref);
            },
            getAll: async (...refs) => {
              assert.equal(writes.length, 0, "read before transaction writes");
              return getAll(...refs);
            },
            create: (ref, data) => writes.push({ kind: "create", ref, data }),
            set: (ref, data, options) =>
              writes.push({
                kind: options?.merge ? "update" : "set",
                ref,
                data,
              }),
            update: (ref, data) => writes.push({ kind: "update", ref, data }),
            commit: () => {
              for (const { kind, ref, data } of writes) {
                if (kind === "create")
                  assert.ok(!records.has(ref.path), "receipt must be new");
                const next =
                  kind === "update" ? { ...records.get(ref.path) } : {};
                for (const [key, value] of Object.entries(data))
                  next[key] =
                    value && typeof value === "object" && "increment" in value
                      ? (next[key] || 0) + value.increment
                      : value;
                records.set(ref.path, structuredClone(next));
              }
            },
          };
        }
        if (retryCallback) await callback(transaction());
        const tx = transaction();
        const result = await callback(tx);
        tx.commit();
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
