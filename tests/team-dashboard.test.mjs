import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
function load(path, imports = {}) {
 const module = { exports: {} };
 vm.runInNewContext(ts.transpileModule(readFileSync(path,"utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, exports: module.exports, require: id => { if(id in imports) return imports[id]; throw Error(id); }, Date, Intl, Set, Map, WeakMap });
 return module.exports;
}
class PracticeError extends Error { constructor(message,status) { super(message); this.status = status; } }
const stats = load("src/lib/statistics.ts");
const server = load("src/lib/server/team-dashboard.ts", { "server-only": {}, "./site-team": {siteTeam: () => ({id: "school"})}, "./practice-persistence": { PracticeError }, "@/lib/statistics": stats, "./dashboard": { timestampISO: v => typeof v === "string" ? v : null } });
test("staff authorization requires verified current staff in configured school", async () => {
 for(const [verified,data,allowed] of [[true,{role:"teacher",teamId:"school"},true],[true,{role:"admin",teamId:"school"},true],[false,{role:"admin",teamId:"school"},false],[true,{role:"student",teamId:"school"},false],[true,{role:"teacher",teamId:"other"},false],[true,undefined,false]]) {
 const db = {doc: () => ({get: async () => ({data: () => data})})};
 if(allowed) assert.equal(await server.requireTeamStaff(db,"staff",verified),"school");
 else await assert.rejects(server.requireTeamStaff(db,"staff",verified), e => e.status === 403);
 }
});
test("roster reads only configured school members and resolves actual staff roles", async () => {
 const db = {collection: path => {assert.equal(path,"teams/school/members"); return {get: async () => ({docs: [{id:"a",data:()=>({displayName:"Zoe"})},{id:"b",data:()=>({displayName:"Amy"})}]})};}, doc: path => ({get: async () => ({data: () => path === "staff/a" ? {role:"teacher",teamId:"school"} : {role:"admin",teamId:"other"}})})};
 const rows = await server.loadTeamRoster(db,"school");
 assert.equal(rows[0].uid,"b"); assert.equal(rows[0].role,"student"); assert.equal(rows[1].role,"teacher");
});
