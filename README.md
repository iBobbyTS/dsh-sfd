# @ibobbyts/dsh-sfd

> Sectioned Feature Development（SFD）的 DSH 插件：把「规划 → 计划评审 → 实现 → 提交 → 代码评审 → 验收」变成可中断、可接手的持久流程。

## 简介

SFD 是一套分节开发方法：先写需求合同（REQUIREMENTS）与完整计划（PLAN-FULL），把工作切成边界清晰、可独立验收的 Feature / Section，再按「计划评审 A/B → 实现 → 提交 → 代码评审 → 验收」推进。本插件把流程中机械的部分（状态记账、派发、波次门禁、报告落盘、提交）交给宿主程序，主 agent 只做语义判断——规划、finding 准入、返工判断与验收——并自行完成启动前的工作区准备（脏区处理、分支基线决策、feature 分支创建，按 skill 中的强制决策表执行）。

仓库权威文档：

- [REQUIREMENTS.md](REQUIREMENTS.md)：需求合同（唯一需求权威）。
- [DESIGN.md](DESIGN.md)：实现设计 v2，含架构与分期（§10）。

## 安装与启用

- 本包是 DSH 的宿主插件，由所在 bundle 的 [`cordis.patch.yml`](cordis.patch.yml) 插入激活（`id: dsh-sfd`）。
- 前置条件：`/sfd` 启动时会做 external-subagent（ES）预检；ES 缺失或没有任何可 spawn 的 subagent 时直接报错并给出原因，不会静默开始。本插件**不使用 ES profile**。
- 流程 skill 随包分发（`skills/sectioned-feature-development/`），经 `ctx.skills` provider 注册，安装/升级/卸载与插件一体。
- 卡片与简报文案在 [`locale/`](locale/) 的 JSON 中（中/英）。

## 侧栏面板

右侧面板里有一张常驻卡片 **Sectioned Feature Development**（guide 顺序 40，正好在 **浏览器** 下面），点开是一个 tab 页面：

- 顶部两页导航：**Status**（暂时留空，等流程产出实时进度后接入）与 **Configuration**。
- Configuration 两个分区：**Global** 与 **Current Project**（按会话工作目录所属 Git 仓库根区分）。每个分区各 6 行阶段：Plan Review A / Plan Review B / Implementation Standard / Implementation Large / Code Review A / Code Review B。
- 每行一个模型下拉，左侧是原生/外部切换开关——该开关**固定为 external 且禁用**，因为流程的每个阶段都只派发给外部 subagent。
- 模型候选来自 external-subagent 守护进程：宿主执行 `external-subagent subagents status --probe`（与 MCP 的 `external_subagent_status(probe=true)` 同一数据源），只列出 enabled + `spawn_supported` + 可 spawn 传输的 subagent，并按 subagent 分组给出其 `models.tokens`。目录缓存 30 秒，面板右上角的刷新按钮会强制重新探测；CLI 位置按 `EXTERNAL_SUBAGENT_BIN` → 常见安装路径（`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`）→ `PATH` 依次解析。

模型路由保存在 `$DSH_HOME/dsh-sfd.json`（权限 0600、原子写）：`global.stages` 对所有项目生效，`projects[<repo root>].stages` 只对该仓库生效。Global 里某项为 `null` 表示未配置；Current Project 里某项为 `null` 表示**继承 Global**（下拉第一项显示 `继承 Global (subagent - model)` / `Inherit Global (subagent - model)`）。这两层选择由插件的派发器消费（见下）。

> 面板的浏览器半（`lib/client.js`）是新增的 `dsh.client` 能力。DSH 只在启动时扫描一次 `dsh.client` 声明，所以**升级后第一次启用需要重启 DSH**（Desktop 退出重开，或重启 dsh Host）；之后每个会话的右栏布局会自己恢复。

## 阶段派发（spawn 由插件，等待由 agent）

`sfd_spawn_stage(stage, prompt, unit?)` 是唯一的派发入口：

- **插件决定**：阶段 → 角色（plan review / implementation / code review）、该阶段的 subagent 与 model（Current Project 优先，其次 Global）、权限模式（评审 = `plan` 只读，实现 = `build`）、effort（按 subagent 查表），以及**角色指令文本**——它作为 `developer_instructions` 随这次 spawn 内联下发，因此不再需要任何 ES profile，执行者与模型可以自由组合。
- **调用方只给**：任务正文（要内联的合同/计划/diff、报告落盘路径、这一趟要判定什么）。角色规则不要重复写进 prompt。
- **交接文件由 agent 写**：评审请求 / TASK / 报告路径都进 `.agent-work/`，spawn 的 prompt 只引用这些路径；角色规则不进 prompt。
- **评审计数归插件**：每次 spawn 在同一次原子写里把计数 +1（阶段级；给了 `unit` 就是 `阶段@unit`），随 actor 一起落盘。报告与判定仍归 agent，但“这个 section 用了几轮评审”不再靠模型记：它会出现在注入块、接手简报与状态文件里。
- **派发即止**：工具返回 ES `agent_id` 与本次路由，并把 actor 记进 `sfd-state.json`（id ↔ 阶段、路由、来源、spawn 时间），接手对账读的就是它。**等待、取报告、关闭任务由 agent 自己做**：`external_subagent_wait` → `external_subagent_result` → `external_subagent_close`；插件不读报告、不做判定，agent 读完自己继续流程。
- **阶段上下文注入**：每次插件状态变更（`sfd_start`、一次 spawn）后，agent 的下一步会收到一段 `[SFD]` 阶段块——阶段、任务、计划/单元/actors（id、路由、已 spawn 多久）、hold、一句下一步提示、工具与 skill 指针。它按 state revision 去重，稳定步骤不重复、不读盘。
- **advisor 仍归插件**：需要升级时 agent 调 `sfd_advisor_trigger`，由插件冻结证据、渲染诊断、打包、发飞书并置 hold；是否升级由 agent 判断。
- 拒绝先于建任务：阶段未配置模型、选定 subagent 当前不可 spawn、运行已挂起或已 DONE，都会得到结构化错误而不是一个失败任务。

## 快速开始

1. 在仓库内输入 `/sfd`。
2. 若没有任何 SFD 状态文件，命令只做交接：主 agent 先读流程 skill；会话里没有任务上下文时，它会先问你「要做什么」。
3. 任务明确后，主 agent 按流程 skill 中的**强制决策表**自行完成工作区准备——脏工作区处理（停止/自动提交/按你的自由文本指示）、不在 main 时按 ahead/behind 与你确认基线（留在当前分支 / 从当前或 main 开新分支 / fast-forward / 分叉时由它合并解决冲突）、退化状态（无 main、分离 HEAD、merge 进行中）询问你——然后自己命名并创建 feature 分支（如 `sfd/readme-faq`）。
4. 准备完成后，主 agent 调用 `sfd_start(taskSummary, slug?, branch?)`。该工具**不执行任何 git 操作**：只记录观察到的 git 事实（分支、基线、脏否）并原子写 `.agent-work/sfd-state.json`。
5. 规划阶段：主 agent 写 `.agent-work/REQUIREMENTS.md` 与 `.agent-work/PLAN-FULL.md`。

## 当前状态（P0）

已实现：

- `/sfd` 命令：状态探测与分流（接手简报 / 旧目录标记提示 / 新流程交接，交接含启动准备决策表指引）。
- `sfd_start` 工具：ES 预检、只读探测 git 事实（分支/基线/脏否）、原子写状态文件；不执行任何 git 写操作——工作区准备由主 agent 按 skill 决策表自行完成。
- 右侧面板：guide 卡片（浏览器下方）+ Status / Configuration 两页；Configuration 的 Global 与 Current Project 各配 6 个阶段的模型（external 固定），候选来自 external-subagent 探针。
- `sfd_spawn_stage` 工具：按面板路由 + 内置角色指令内联派发 ES 任务（不使用 profile），记录 actor 后把 `agent_id` 交回 agent 自行 wait/result/close。
- 阶段上下文注入：`agent/pre-step` 按 revision 推送 `[SFD]` 阶段块（事实 + 下一步指针），让主 agent 不必靠记忆维持流程。

尚未实现（见 [DESIGN.md](DESIGN.md) §10 分期）：

- P1：计划结构校验、计划评审编排与 finding 准入、TASK 生成与 `impl_*` 派发、故障协议。
- P2：代码评审编排、wave 门禁、B1/B2 盲审、advisor 与飞书通知。
- P3：侧栏面板的 Status 实时进度、接手对账、归档（面板骨架与模型路由配置已提前实现）。
- P4：流程 skill 打磨、ES 状态区与面板交互细节。

因此当前版本能把一次 SFD 运行从 `/sfd` 推进到规划产出，但**不能**自动走完评审、实现、提交与验收。

## FAQ

### `/sfd` 输入后好像没反应？

先看是否真的没反应：新流程下 `/sfd` 本身不创建状态，它只是把交接文本注入会话（后台日志里有 `sfd: followup delivered` 之类的记录），真正落状态的是主 agent 之后的 `sfd_start` 调用。如果连交接文本都没出现，检查插件是否被载入、以及当前会话是否为根 agent（命令只在根 agent 上执行）。

### 为什么只有一个 `/sfd`，没有子命令？

需求合同（REQUIREMENTS.md §Required user-visible behavior 第 1 条）明确规定单命令、无子命令。分流依据是状态文件：有状态就出接手简报，没状态就走新流程交接。需要「开始/继续/归档」之类的区分时，由主 agent 读完简报后决策，而不是增加子命令。

### `.agent-work/sfd-state.json` 可以手动修改吗？

不可以。它是唯一的机器状态，约定为**程序独写、原子落盘**（先写临时文件再 rename）。手改可能让流程读到自相矛盾的状态；需要干预时，应该告诉主 agent 你的意图，由它决定继续 / 归档 / 变更基线，而不是改 JSON。

### 状态文件损坏或残留了旧目录怎么办？

JSON 损坏时，读取会直接报错；如果只有 `PLAN-FULL.md` / `REQUIREMENTS.md` / `FEATURE-STATE.md` 等 markdown 残留而没有 `sfd-state.json`，`/sfd` 会把它当作旧运行标记提示你，而不是静默覆盖。两种情况下都由主 agent 征询并决定清理方式。

### 没有安装 external-subagent 会怎样？

启动即失败：`/sfd` 与 `sfd_start` 都会先做 ES 预检，缺失时返回明确错误（`es-missing`，或已装但无可 spawn subagent 的 `es-subagents`），不会进入启动准备或规划。先装 ES 并 `external-subagent agents enable <zcode|dsh|codex|agy>`，再执行 `/sfd`。

### feature 分支是谁创建的？工作区清理是谁做的？

都是主 agent，用它会话里的常规 git 工具完成。流程 skill 中的启动决策表是**强制指引**：脏工作区必须先问用户（停止/自动提交/按自由文本指示）；干净且在 main 时直接建分支；不在 main 时按 ahead/behind 提供固定选项集；无 main/分离 HEAD/merge 进行中时询问用户。插件本身不执行任何 git 操作——`sfd_start` 只读探测并落盘状态。

### 什么时候主 agent 会先征求我的同意？

两类情况：一是**自动激活**——你没有输入 `/sfd` 也没有点名要用 SFD，主 agent 自己判断任务符合触发条件时，必须先在对话里征得你同意，才能开始任何启动准备或调用 `sfd_start`；显式输入 `/sfd` 或口头点名即视为已同意启动。二是流程决策表要求问你的点：脏工作区、不在 main 时的基线选择、退化状态（无 main / 分离 HEAD / merge 进行中）。首个计划产出后不再有单独的用户批准暂停，直接进计划评审。

### 现在能一路跑完整个 SFD 流程吗？

不能。P0 只覆盖到规划产出；评审编排、实现派发、程序化提交、代码评审与验收的工具还没实现（见上文「当前状态」）。规划之后的工作目前需要手工完成。

### `.agent-work/` 会被提交进仓库吗？

不应该。它是流程工作目录（状态、计划、报告、HANDOFF），按设计保持未跟踪；交付物是产品代码与文档本身，而不是流程账本。

## 文档索引

- [REQUIREMENTS.md](REQUIREMENTS.md) — 需求合同与验收标准。
- [DESIGN.md](DESIGN.md) — 架构、状态机、工具面与分期。
- [skills/sectioned-feature-development/](skills/sectioned-feature-development/) — 流程 skill 与规划知识库（随包分发）。
