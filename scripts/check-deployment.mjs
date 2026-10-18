import { deploymentIssues } from "./deployment-config.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => !["--local", "--if-vercel"].includes(arg))) {
  console.error(
    "Use --local for local ADC configuration, or --if-vercel for the build hook.",
  );
  process.exitCode = 1;
} else if (args.includes("--if-vercel") && process.env.VERCEL !== "1") {
  console.log(
    "Hosting preflight skipped outside Vercel. Run pnpm check:deployment against hosting environment variables before deployment.",
  );
} else {
  const issues = deploymentIssues(process.env, {
    local: args.includes("--local"),
  });
  if (issues.length) {
    console.error(
      "Deployment configuration needs attention:\n" +
        issues.map((issue) => `- ${issue}`).join("\n"),
    );
    process.exitCode = 1;
  } else
    console.log(
      "Deployment configuration checks passed. Service connectivity, authorized domains and provider eligibility still require verification.",
    );
}
