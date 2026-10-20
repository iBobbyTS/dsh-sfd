// src/dsh/role-policy.ts
import Schema from "@deepseek-ai/schemastery";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval";

// src/roles/specs.ts
var READ_TOOLS = ["read", "read_image", "glob", "grep", "structured_output"];
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
  diagnostician: { presetId: "sfd-diagnostician", title: "Diagnosis", access: "reader", toolNames: READ_TOOLS }
};
var ROLE_PRESETS = Object.fromEntries(
  Object.entries(ROLE_SPECS).map(([kind, spec]) => [kind, spec.presetId])
);

// src/roles/prompts.ts
var BLIND_CODE_FIELDS = ["goal", "userDecisions", "plan", "section", "features", "upstream", "phase", "candidate", "requiredChecks", "checks"];
var INDEPENDENT_A_FIELDS = [...BLIND_CODE_FIELDS, "lens"];

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
