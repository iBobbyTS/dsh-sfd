# dsh-sfd

把 Sectioned Feature Development 深度嵌入 **DeepSeek Harness（DSH）** 的原生开发工作流插件。

任务目标、Section 依赖、审查证据、修复预算和恢复状态由 Host 服务持久保存。模型以有边界的 planner、implementer、reviewer、adjudicator 等角色参与；聊天结束或页面关闭不会代表开发任务完成。

当前版本 **0.2.0**，针对 **DSH 0.2.1-rc.2** 构建和验证。方法来自 [sectioned-feature-development](https://github.com/iBobbyTS/sectioned-feature-development)，角色协议已内置于本仓库，不依赖安装或继续维护原 Skill。原 Skill 的规划、代码审查和工作流参考文件作为插件的只读知识资源，供原生角色通过 `sfd_knowledge` 按需读取；旧的 Codex/ZCode 路由表不参与 DSH 调度。

## 安装

先准备已经配置模型和权限的 DSH `0.2.1-rc.2`。安装到现有 profile：

```bash
dsh plugin --profile dev add github:iBobbyTS/dsh-sfd
dsh --profile dev --dump-config
dsh --profile dev
```

也可以固定已审阅的提交：

```bash
dsh plugin --profile dev add github:iBobbyTS/dsh-sfd#<commit-sha>
```

仓库包含 `lib/` 构建产物，没有安装期构建脚本。源码开发或本地安装：

```bash
git clone https://github.com/iBobbyTS/dsh-sfd.git
cd dsh-sfd
npm ci --ignore-scripts
npm run check
dsh plugin --profile dev add "$PWD" --ignore-scripts
```

Web 界面需要 profile 包含 DSH 的 Web UI；纯 Host profile 可以使用 `/sfd` 命令。插件 bundle 安装一个 Host 服务和 11 个独立角色 preset。

## 开始一个任务

在仓库根目录对应的普通 DSH 会话中选择模型，并授予该任务所需的原生写权限。然后打开侧栏 **Development**：

1. 选择任务所属的会话。
2. 点击 **New run**，填写完整目标、约束和验收要求。
3. 创建后点击 **Start**。创建与启动分开，便于先检查任务目标和交付选项。

**自动激活与显式调用的区别：** Agent 通过 `sfd_run` 工具创建的 Run 在产生第一份 PLAN 后暂停，等待你在 Development 面板中核对并批准，再进入独立 PLAN A/B。用户直接在 UI 或 `/sfd` 命令中显式启动不增加这一暂停；这与原 SKILL 的激活边界一致。

与原 SFD 的 `EXECUTE_WITH_COMMIT` 一致，任务验收后会在独立的 `sfd/<run-id>` 非 main 分支提交精确候选。不会自动 push、合并到默认分支或删除原有工作。显式 no-commit 执行请求会被拒绝，而不会悄悄改变原工作流的交付模式。

同样的操作可以通过命令完成：

```text
/sfd create 实现按当前账户导出记录，并验证跨账户隔离和完整导出路径
/sfd list
/sfd start <run-id>
/sfd status <run-id>
/sfd pause <run-id>
/sfd resume <run-id>
/sfd revise <run-id> 更新后的完整目标和约束
/sfd cancel <run-id>
/sfd help
```

需要用户作出具体决定时，使用界面中的问题表单，或：

```text
/sfd decide <run-id> <decision-id> continue 用户对当前问题的明确决定
```

命令支持 `continue`、`retry`、`replan`、`cancel`。这些动作不等于审查通过，也不会重置原始修复预算。普通聊天 Agent 可使用 `sfd_run` 工具创建、启动和观察任务；需求修订和问题裁决通过用户界面或命令提交。

原 SFD 的 ADV-01—ADV-06 外部人工 Advisor 条件会冻结原 Run 和来源证据。查看 Development 面板中的当前 Advisor request（包含原目标、当前计划、lineage、候选身份、finding、检查及模型失败事实），人工取得实际建议后填写原文和独立采纳决定，或使用：

```text
/sfd advisor <run-id> <decision-id> <accept|reject|clarify> <continue|replan|cancel> <verbatim-advice>
```

不会自动联系外部 Advisor，也不会把项目源码或对话上传给第三方。当前提供的是持久化的证据索引和人工接管 UI，**不自动生成原 Skill 的脱敏 Advisor ZIP，也不自动通过飞书发送通知**；需要用户自行检查候选代码和敏感内容后交接。未人工裁决的 Advisor hold 不允许通过 `revise` 或 `resume` 绕过。

## PLAN_HANDOFF（只规划、不写产品代码）

原 SFD 的 `PLAN_HANDOFF` 现在可以直接使用：在 Development 面板将 Intent 选择为 **PLAN_HANDOFF** 后创建并启动，或在拥有仓库的会话中输入 `/sfd plan <goal>`。程序执行 Planner → 独立 PLAN A → 独立 PLAN B（含必要的有界修订/裁决），完成后在 Run 中保留已审查的结构化计划和证据。此模式不创建任务 worktree、不运行产品 Implementer、不执行产品检查、不提交 Git；它允许原生只读 Session。`sfd_run` 工具也可通过 `create` 的 `intent: plan-handoff` 创建，随后显式 `start`。旧 Run 未设置 Intent 时保持原执行模式。

`REVIEW_ONLY`、跨 Section 并行实施及旧版任务中途接管尚未在这一阶段实现，不应把 PLAN_HANDOFF 的交付错误标记成已实现这些模式。

## 执行过程

| 阶段 | Host 控制的行为 |
| --- | --- |
| 规划 | Planner 提出 Feature/Section DAG；PLAN A、PLAN B 串行独立；material PLAN finding 必须由独立的 Main 语义裁决角色核实后才能形成计划修订；修订用有界的原审核槽 PLAN_DELTA |
| 实施 | 一个任务工作区同时只有一个实施者；非空 Subsection 列表按顺序执行、检查和独立 R01 checkpoint；只有 Parent Section 正式验收才释放外部依赖 |
| 候选 | 捕获完整 Git tree，并为当前父 Section 另提供其启动时的冻结 tree → 当前候选的精确审查 Delta；完整 Feature Diff 只提供整体上下文 |
| Code A | 始终包含 R01 完整行为基线，并按实际风险选择独立审查视角；有界并行 |
| 裁决与修复 | 逐条裁决 finding；R02 可提出有独立 SIMP-### ID 的非阻断简化动作，只有与已确认材料缺陷成批修复时才执行并验证保存性；真实检查、覆盖与适用性决定门禁 |
| Code B | B1 完整盲审当前候选；B2 在同一候选上协调 B1 与 A/closure 证据 |
| 修复闭环 | 材料修复后有针对性的 closure、明确的有效 A 证据复用和新的完整 B1 |
| Feature 验收 | 在同一候选上检查组合路径和共享约束；只有实际未证明的重要跨 Section/Feature 风险才派一次有界独立 integration review，不制造第三轮全量 Section A/B |
| 交付 | 核对实际源码匹配验收候选，在已授权非 main 的 Run 分支提交精确 Git tree；不自动推送或合并 |

只有 Host 的证据准入与阶段条件满足后，Run 才会 `completed`。结束对话、返回结构化 JSON、若干个 `clean` 标签或单独一次测试通过都不能跳过这些条件。

## 长任务如何保持连续

- **目标独立保存。** 原始目标、后续需求版本和用户决定不依赖聊天上下文。明确撤销的目标可以退役，其原有修复历史仍然保存。
- **状态只有一个来源。** 原生 storage domain 保存 Run 聚合；界面是该状态的投影，不维护另一个 Markdown 状态机。
- **模型按需工作。** Host 持有真实、通常空闲的 anchor Agent；使用原生 `spawn` 和 `delivery: caller` 收集角色结果，不靠反复唤醒主聊天维持调度。
- **长任务部分完成不等于失败。** Implementer 可在有真实进展时跨越三个以上连续激活；只有源码和剩余工作多次都没有进展，才进入有界诊断。\n- **版本区分用途。** 聚合 revision、任务输入版本、控制 epoch 分开.一个 A 报告写入不会让同批其他报告过期；暂停或修订后的旧结果不能自动推进新阶段。
- **输入有边界。** 长历史和大 diff 转为只读证据文件与索引，角色可以精确读取；盲审输入在写入文件前就完成过滤。原始目标不会被静默截断，目标本身过大时会明确停止并要求拆分。
- **预算归属于原始 Section。** 五轮常规已准入的实际修复（不因模型标记 nonmaterial 就免费）；达到硬上限后只允许一次有据可查的恢复分类（非结构性至多再一轮；真实结构性替换共享原 lineage、继承恢复已使用状态）。第二次收敛失败进入 ADV-01 的外部人工裁决，绝不重新命名清零。基础设施失败有独立的有限重试规则。
- **暂停等待真实停止。** 若执行器不能及时确认退出，任务保持暂停中/待核对并保留工作区占用，不会宣称写入已停止后继续派发新写者。

## 工作区、检查与恢复

每个 Run 使用 `sfd/<run-id>` 分支和专属 Git worktree。原仓库分支、暂存区及已有修改保持原样；开始时的未提交输入会复制到任务工作区。审查使用冻结的候选工作区，Host 检查使用另一份临时工作区。

每批检查从该候选的新副本开始，按计划顺序运行。被 Git 忽略的依赖、缓存和本机环境不会复制过去；需要的依赖准备应是同批计划里的明确、已授权检查命令。测试命令经过 DSH 的工具权限与沙箱流程。没有可确认的沙箱执行器时，检查记录为 `unknown`，不能当作通过。

测试如果改写了被审查的源码，其结果不会证明原候选。项目要求的 hooks 或生成校验应列为显式、受沙箱约束的验收检查；最终提交使用经过验证的精确 Git tree，不隐式执行仓库 hooks。

进程重启后，Run 会先核对未结束的执行和文件事实。插件不恢复旧 JavaScript Promise，不盲目重发可能已经发生的写入。完成但尚未写回业务状态的工作区准备或 Git 提交，可在确认实际文件/回执后通过恢复决定接纳。

非正常退出可能保留 `owner.json` 工作区占用文件。它的位置会在恢复错误中给出。**先确认原 Host、子任务和外部进程都已停止，核实实际修改，再移除对应的旧占用文件并作出恢复决定。** 插件不会凭时间过期自动抢占潜在写者。详细流程见 [恢复与边界](docs/RECOVERY.md)。

## 配置

以下是 profile 的 `cordis.patch.yml` 覆盖示例：

```yaml
- id: dsh-sfd
  config:
    actorTimeoutMs: 1800000
    maxParallelReviews: 3
    maxInfrastructureRetries: 1
    allowCommits: true
    # 可选：指定持久 worktree/证据目录，必须是绝对路径。
    # stateRoot: /absolute/path/to/dsh-development
```

默认临时工作与证据放在仓库公共 Git 目录的 `dsh-sfd/runs/<run-id>/` 中；权威业务状态仍在 DSH 的 `sfd_development` storage domain。自定义 `stateRoot` 时不要在任务进行中切换位置。

角色会从创建 Run 时的会话配置或 Host `modelRoutes` 得到明确模型，并**在创建 Run 时冻结 transport**：`glm-*` → `external-subagent` / `zcode`，`gpt-*` → `external-subagent` / `codex`，`deepseek-*` → DSH 原生 Subagent。未指定的其他模型族保持原来的 native 方式；不会把 GLM/GPT 失败任务静默改派到 native。显式覆盖某个角色时，应同时提供该模型所在的真实 provider 和 model ID。

```yaml
- id: dsh-sfd
  config:
    actorTimeoutMs: 1800000
    maxParallelReviews: 3
    maxInfrastructureRetries: 1
    allowCommits: true
    modelRoutes:
      plan-review-a:
        provider: zai
        model: glm-5.3
        effort: high
      reviewer-b:
        provider: openai
        model: gpt-6.1-sol
        effort: high
      implementer:
        provider: deepseek
        model: deepseek-flash
    # 当 external-subagent CLI 不在 PATH：
    # externalSubagentExecutable: /absolute/path/to/external-subagent
    # 与原 SFD 的 impl_large 路由对应，供实施等级为 large 的 Section 使用：
    largeImplementerProvider: <your-large-provider-id>
    largeImplementerModel: <your-large-model-id>
    # largeImplementerEffort: high
```

路由固定在 Run policy 中，actor 结果不能更改模型或角色 preset。执行记录区分请求路由与实际请求头观察到的路由，缺失观察时不会伪造模型身份。`standard/large` 使用同一个原生实施者 preset，但可按 Section 等级选择不同的 Host 授权模型路由。**若 PLAN 选择 `large` 而 Host 未配置 `largeImplementerProvider` 与 `largeImplementerModel`，对应执行将阻塞并报告模型配置缺失，不静默降级到 standard。** 为严格复刻旧版独立 A/B 模型组合，仍需在 `modelRoutes` 明确指定每个角色的 provider/model；模型族只决定 transport，不自动挑选哪个角色用哪个版本。外部目标需要提前安装并启用 `external-subagent` daemon 与相应 `zcode` / `codex` subagent。外部 API 使用 CLI JSON stdin，ZCode 模型 token 为 `provider/model`，Codex 为裸 GPT 模型 ID；外部 role 只带原版参考材料和 bounded task，使用 `plan`（reviewer）或根据已有宿主权限对应的 `build`/`yolo`（implementer），**不新增 write_manifest**。共享同一冻结候选工作区的外部 Reviewer 会顺序派发，避免 external-subagent 的 workspace ownership 冲突；这不改变 Code A 独立审查语义。外部模型配置缺失、选择被拒、需人工回答的问题或 JSON 结构化结果不完整都会报告失败/阻塞，不改派 native；成功状态仅记录 daemon 接纳的模型参数，没有 runtime 回显时不会虚构 observed model。由于实现改为 model-family route，旧 Run 若缺少冻结的 transport，不会静默以新方式继续，应完成原运行或明确重新创建 Run。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm pack --ignore-scripts
node scripts/verify-package.mjs
```

测试包括纯状态机回归、Subsection 真实 R01 checkpoint 与子级修复风险路由、PLAN_DELTA / PLAN_NIT / owner-decision 和静默槽退休、逐 finding 修复关闭与 SIMP 保存性、hard-cap 非结构/结构性 lineage 继承、ADV 人工 hold、按需独立 integration review、Section 变更范围、standard/large Host 模型路由、真实临时 Git 仓库与检查进程、真实 Cordis/DSH 原生 spawn/结构化输出、只读知识资源及 UI 控制。模型判断使用确定性的测试提供方；这些测试不代表已对真实付费模型的规划与审查质量做基准测评。CI 使用 Node 24，并验证提交的 `lib/` 与源码一致。

参见 [实施计划](docs/IMPLEMENTATION-PLAN.md)、[架构与不变量](docs/ARCHITECTURE.md)、[原 Skill 迁移映射](docs/SKILL-NATIVE-PARITY.md)、[验证记录](docs/VALIDATION.md)。

## 当前支持边界

针对 DSH `0.2.1-rc.2`、已有初始提交的普通 Git 仓库和 Bash 兼容的受沙箱约束的检查环境实现。Submodule 的独立工作树、会改变源码内容的 checkout filter、跨多个 Host 自动接管，以及旧 SFD Markdown 状态的自动导入不在当前版本范围内。持久状态拒绝不匹配的 schema、workflow 和 policy 版本；此版升级了 Core/Policy/Role 协议（Core 1.1.0 / sfd-native-2 / roles-2），尚没有为旧的活动 Run 提供自动转换。**升级前应先结束或保存并另行处理 0.1.0 的 Run**，不要假定它们可以无损继续执行。

对于依赖原生持久状态的旧 `0.1.0` Run，本版本不提供自动原地升级；升级 DSH Host 前先结束活动任务或单独保留旧状态供人工迁移。外部人工 Advisor 的材料必须由用户检查敏感信息后自行交接，插件不会自动生成脱敏 ZIP 或向第三方发送源代码。

MIT，保留原仓库许可证。
