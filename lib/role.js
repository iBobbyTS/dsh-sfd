// src/dsh/role-policy.ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval";

// src/roles/specs.ts
var READ_TOOLS = ["read", "read_image", "glob", "grep", "structured_output", "sfd_knowledge"];
var WRITE_TOOLS = [...READ_TOOLS, "write", "edit", "bash"];
var ROLE_SPECS = {
  planner: { presetId: "sfd-planner", title: "Planner", access: "reader", toolNames: READ_TOOLS },
  "plan-review-a": { presetId: "sfd-plan-review-a", title: "Plan review A", access: "reader", toolNames: READ_TOOLS },
  "plan-review-b": { presetId: "sfd-plan-review-b", title: "Plan review B", access: "reader", toolNames: READ_TOOLS },
  implementer: { presetId: "sfd-implementer", title: "Implementer", access: "writer", toolNames: WRITE_TOOLS },
  "review-selector": { presetId: "sfd-review-selector", title: "Review selection", access: "reader", toolNames: READ_TOOLS },
  "reviewer-a": { presetId: "sfd-reviewer-a", title: "Code review A", access: "reader", toolNames: READ_TOOLS },
  "reviewer-b": { presetId: "sfd-reviewer-b", title: "Code review B", access: "reader", toolNames: READ_TOOLS },
  adjudicator: { presetId: "sfd-adjudicator", title: "Evidence adjudication", access: "reader", toolNames: READ_TOOLS },
  "closure-reviewer": { presetId: "sfd-closure-reviewer", title: "Repair closure", access: "reader", toolNames: READ_TOOLS },
  "feature-verifier": { presetId: "sfd-feature-verifier", title: "Feature acceptance", access: "reader", toolNames: READ_TOOLS },
  diagnostician: { presetId: "sfd-diagnostician", title: "Diagnosis", access: "reader", toolNames: READ_TOOLS },
  "advisor-notice": { presetId: "sfd-advisor-notice", title: "Advisor Notification Fields", access: "reader", toolNames: ["structured_output"] }
};
var ROLE_PRESETS = Object.fromEntries(
  Object.entries(ROLE_SPECS).map(([kind, spec]) => [kind, spec.presetId])
);

// src/roles/prompts.ts
var BLIND_CODE_FIELDS = ["goal", "userDecisions", "plan", "section", "features", "upstream", "phase", "candidate", "requiredChecks", "checks"];
var INDEPENDENT_A_FIELDS = [
  ...BLIND_CODE_FIELDS,
  "lens",
  "integrationGap",
  "feature",
  "subsection",
  "checkpointMode",
  "targetFindingIds",
  "previousCheckpoints",
  "jointCriteria",
  "obligation"
];

// src/dsh/role-policy.ts
var name = "sfd-role-policy";
var inject = ["tools", "sandboxPolicy", "approval"];
var Config = Schema.object({
  kind: Schema.union(Object.keys(ROLE_SPECS)).required()
});
function apply(ctx, config) {
  const role = ROLE_SPECS[config.kind];
  if (role === void 0) throw new Error(`Unknown SFD role: ${String(config.kind)}`);
  const allowed = new Set(role.toolNames);
  ctx.tools.register(defineTool({
    name: "sfd_knowledge",
    description: "Read a selected, packaged SFD planning, review or workflow reference. Begin with planning/router.md or review/review-routing.md; load only material applicable to the current task.",
    parameters: { path: { type: "string", required: true, description: "Repository-relative knowledge path such as planning/router.md." } },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute(args) {
      if (!/^(planning|review|workflow)\/[A-Za-z0-9_./-]+\.md$/.test(args.path) || args.path.includes("..")) throw new Error("Unsupported SFD knowledge path.");
      const bases = [resolve(dirname(fileURLToPath(import.meta.url)), "../../knowledge"), resolve(dirname(fileURLToPath(import.meta.url)), "../knowledge")];
      for (const base of bases) {
        const target = resolve(base, args.path);
        const rel = relative(base, target);
        if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Knowledge path escapes its package.");
        try {
          return await readFile(target, "utf8");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      throw new Error("The named SFD knowledge reference is not bundled.");
    }
  }));
  ctx.tools.guard((exec) => allowed.has(exec.name) || exec.name === "run_code" ? void 0 : `The ${role.title} role cannot execute ${exec.name}.`);
  ctx.on("agent/created", ({ agent }) => {
    const inherited = agent.ctx.tools.schemas(agent).map((tool) => tool.name).filter((tool) => allowed.has(tool) && tool !== "structured_output" && tool !== "run_code");
    agent.ctx.tools.restrict({ allow: inherited });
    if (role.access === "reader") setSandboxMode(agent.session, "read-only");
    setApprovalPolicy(agent.session, "never");
    return void 0;
  });
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=role.js.map
