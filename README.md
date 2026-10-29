# @ibobbyts/dsh-sfd

> Sectioned Feature Development（SFD）的 DSH 插件：**观察 + 注入**。流程由主 agent 按 skill 自己驱动，插件把「该做而没做的评审」持续摆在它眼前。

## 简介

做这个插件的起因很具体：SFD skill 在长会话里执行时，主 agent 会**跳过一些 review**——一份 markdown 流程读过一次之后，扛不住上下文压力。解决方向（2026-10-29 修订）不是把流程程序化，而是：

- **流程、派发、判定全部归主 agent**：它按随包分发的 skill（上游 v5.5.2 + DSH 补充）驱动，包括每次 external-subagent 派发——**和 skill 一样，原样调用 `external_subagent_spawn(profile="sfd-*")`**，路由表是 skill 里的 DSH dispatch profile，profile 由 skill 安装器装进 external-subagent 的 per-user 目录；wait / result / close、报告读取、finding 准入、预算判定、验收，也都是它的事。
- **插件只做两件事**：观察（watch 工具调用与 `.agent-work/` 写入，记进运行账本）与注入（运行期间，把观察事实 + skill 义务作为 `[SFD]` 块注入主 agent 的每一步，防止跳过评审）。

被明确**移除**的旧能力（v0 胖插件方向）：模型路由面板、`sfd_spawn_stage` 插件代派发、阶段状态机与门禁、评审计数随 spawn 原子记账、内置角色指令。计数现在来自**观察**：插件看到的每次 spawn 派发按角色入账，与 actor 记录同写。

仓库权威文档：[REQUIREMENTS.md](REQUIREMENTS.md)（需求合同，唯一需求权威）。

## 安装与启用

- 本包是 DSH 的宿主插件，由所在 bundle 的 [`cordis.patch.yml`](cordis.patch.yml) 插入激活（`id: dsh-sfd`）。
- 前置条件：**skill 的 sfd-* spawn profile 已安装**（来自 [skills 仓库](../sectioned-feature-development) 的 `scripts/install.py`，装进 external-subagent per-user profiles 目录）。插件本身不读不写 ES 的 profiles 目录；派发是否可行由 agent 派发时用 `external-subagent profile list` 验证（skill 的规则）。
- 流程 skill 随包分发（`skills/sectioned-feature-development/` 与伴侣 `skills/code-review/`），经 `ctx.skills` provider 注册，安装/升级/卸载与插件一体。
- 卡片与简报文案在 [`locale/`](locale/) 的 JSON 中（中/英）。

## 观察与注入（插件的核心）

**账本 `.agent-work/sfd-run.json`（插件独写）**。`/sfd` 交接、`sfd_start` 落锚之后，插件观察两样东西：

- external-subagent 工具调用（`spawn / wait / result / close`，含 MCP 前缀形态）：spawn 取 `profile`、`agent_id`、prompt 首行与 `.agent-work/` 报告路径提示，按角色（plan-review / impl / code-review / …）入账计数；wait/result 更新 actor 状态与终态；close 标记回收。
- `write` / `edit` 对 `.agent-work/` 下文件的写入：PLAN / reviews / handoffs 分类记录。

观察只在**运行进行中**发生（`sfd_finish` 关闭后停止），失败静默不破坏工具调用。

**`[SFD]` 义务注入**。账本每次变更（revision +1）后，主 agent 的下一步会收到一段紧凑块：运行头（slug@branch · rev · 阶段）、actor 摘要与明细、派发计数、报告计数，以及按 skill 推导的**义务**——例如：

- PLAN 评审 A→B 两路独立覆盖未关闭（观察：派发 n / 终态完成 m）；
- ⚠️ implementer 已派发但 PLAN 覆盖未关闭（skill 不允许——补救或说明依据）；
- 派发 Code A 前冻结候选；B1 盲审不携带 A 结论；
- 等待终态 / 回收已完成 actor 的具体 id 列表。

块是**事实 + 指针**，不是门禁、不是授权，也不替代读 skill；revision 去重，稳定步骤不注入，但未消解的警告会在约 6 步后重注入一次（防漂移）。预算判定（每 section 5 waves、plan 2 material waves）归 skill，注入块只给计数。

## 运行锚点（仅有的两个工具）

- `sfd_start(taskSummary, slug?, branch?)`：工作区准备（按 skill 强制决策表，由主 agent 自己做）完成后调用一次；不做 git 操作、不派发，只记录观察到的 git 事实并创建账本。
- `sfd_finish()`：整个授权计划完成并归档后调用；关闭账本、停止注入。中断接手不调用它——新会话 `/sfd` 会从账本注入接手简报（观察事实 + 义务 + 未对账 actor 清单）。

## 侧栏面板

右侧面板常驻卡片 **Sectioned Feature Development**（guide 顺序 40，正好在 **浏览器** 下面），单页 **Status**（只读）：

- 运行头（阶段 / 分支 / 任务）、已观察 actor 表（id、profile、终态、报告路径）、派发计数、义务提醒（与注入内容同源，警告高亮）。
- external-subagent 状态区：宿主执行 `external-subagent subagents status --probe`（与 MCP `external_subagent_status(probe=true)` 同源），列出可 spawn 的 subagent；探测缓存 30 秒，右上角刷新按钮强制重探。

面板不再有任何配置项——路由由 skill 的 dispatch profile + 安装器管理，不经面板。

## 快速开始

1. 在仓库内输入 `/sfd`。
2. 没有运行账本时，命令只做交接：主 agent 先读流程 skill；会话里没有任务上下文时，它会先问你「要做什么」。
3. 任务明确后，主 agent 按 skill 的**强制决策表**自行完成工作区准备（脏区处理 / 基线决策 / feature 分支创建），然后调用 `sfd_start`。
4. 之后一切按 skill 走：写 PLAN-FULL → 原样调用 `external_subagent_spawn(profile="sfd-zcode-plan-review")` 等派发行 → 自己 wait/result/close → 准入与修正 → 实现 → 冻结 → Code A/B → 验收归档 → `sfd_finish`。全程每一步都有 `[SFD]` 块盯着未完成的评审义务。

## FAQ

### `/sfd` 输入后好像没反应？

新流程下 `/sfd` 本身不创建账本，它只注入交接文本（后台日志有 `sfd: followup delivered`）；真正落账的是主 agent 之后的 `sfd_start`。连交接文本都没有时，检查插件是否载入、会话是否根 agent。

### `.agent-work/sfd-run.json` 可以手动修改吗？

不可以。它是插件的独写账本（原子落盘）。需要干预时告诉主 agent 你的意图，由它决策；旧格式的 `sfd-state.json` 已被当作遗留标记处理，不会被读取。

### 没有安装 external-subagent 会怎样？

面板 ES 区会显示不可用；agent 派发时 skill 的规则生效（capability blocker，如实报告并重装，不内联替代）。插件启动不做 ES 硬预检——派发本来就是 agent 的事。

### feature 分支是谁创建的？工作区清理是谁做的？

主 agent，用它会话里的常规 git 工具，按 skill 强制决策表执行；插件不执行任何 git 操作。

### 什么时候主 agent 会先征求我的同意？

自动激活（你既没输 `/sfd` 也没点名 SFD）时，它必须在任何启动准备之前征得你同意；显式 `/sfd` 即视为同意。其余是决策表要求询问的点：脏工作区、不在 main 的基线选择、退化状态。计划产出后没有单独的批准暂停，直接进计划评审。

### 会不会又长回调度器？

不会：插件没有阶段状态机、没有门禁、没有派发。它只有「观察到的账本 + 注入的义务」，判定权始终在主 agent 与 skill；注入块与 skill 冲突时，以 skill 为准（SKILL.md 的 DSH 补充里写明）。

### `.agent-work/` 会被提交进仓库吗？

不应该。它是流程工作目录（账本、计划、报告、HANDOFF），按设计保持未跟踪。

## 文档索引

- [REQUIREMENTS.md](REQUIREMENTS.md) — 需求合同（唯一需求权威）。
- [skills/sectioned-feature-development/](skills/sectioned-feature-development/) — 流程 skill（上游 v5.5.2 + DSH 补充与 dispatch/dsh.md，随包分发）。
- [skills/code-review/](skills/code-review/) — 共享审查方法（上游伴侣 skill，随包分发）。
