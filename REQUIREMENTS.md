# SFD → DSH 插件：需求合同（Requirements Contract）

v2，2026-10-29。本版**整体取代** 2026-10-22 的 v1 合同：v1 描述的「Host 状态机接管记账/派发/调度/门禁/通知」方向在实施中被判定为过度程序化，本合同记录修订后的边界。本文件是唯一需求权威。

## 背景与目标

插件化的真实动因：SFD skill（上游 v5.5.2）在长会话中执行时，主 agent 会**跳过部分 review**——markdown 流程读过一次后，随上下文压力失效。

目标：**在合理的时机通过插件注入上下文**，让被跳过的评审义务持续出现在主 agent 面前；同时把派发还给主 agent，与 skill 原生形态一致（原样调用命名 ES profile 的 `external_subagent_spawn`）。成功条件：一次运行中，PLAN A/B、Code A/B 的可观察派发事实始终被记录并注入；跳过行为发生时主 agent 会被明确警告。

## 职责边界（v2 核心）

| 归属 | 内容 |
|---|---|
| **主 agent + skill** | 全部流程：规划、派发（原样 `external_subagent_spawn(profile="sfd-*")`）、wait/result/close、报告读取、finding 准入、预算判定（5 waves/section、plan 2 material）、tier 选择、冻结与盲审纪律、验收、归档、提交 |
| **插件** | 观察账本（actor、派发计数、`.agent-work` 工件）、`[SFD]` 义务注入、`/sfd` 交接、`sfd_start`/`sfd_finish` 锚点、只读状态面板、随包分发 skill |

**明确移除**（v1 有、v2 不要）：模型路由面板与两层配置存储、插件代为 spawn、阶段状态机与任何门禁（gated/hold）、插件读 actor 报告、程序化提交（`ctx.gitCommit`）、advisor 程序化流程、飞书通知、B1 盲审 prompt 构造、ES 硬预检。

## 必备行为

1. **单一命令 `/sfd`**（无子命令）：无账本 → 新流程交接（读 skill → 问任务 → 工作区决策表）；有账本且 active → 注入接手简报（观察事实 + 义务 + 未对账 actor）；已关闭 → 提示新开；只有遗留标记（含旧 `sfd-state.json`）→ 提示决策，不静默覆盖。
2. **激活批准**（2026-10-28 裁定）：仅 agent 自动激活时，须在任何启动准备与 `sfd_start` 之前获得用户批准；显式 `/sfd` 或点名即视为已批准。计划产出后无用户批准暂停（上游 v5.5.2 已采纳该裁定：批准在启动前、无 first-plan pause）。
3. **工作区准备**：agent 提示词驱动的强制决策表（脏区询问、main 直接建分支、ahead/behind 固定选项集、退化状态询问），与 v1 §3 相同，落在 skill 的 DSH 补充与 `/sfd` 交接文本中；插件不做任何 git 操作。
4. **`sfd_start(taskSummary, slug?, branch?)`**：只读探测 git 事实（分支/基线/脏否/detached/mid-merge），创建 `.agent-work/sfd-run.json`；不做 ES 预检、不派发。已有运行 → 返回观察简报而非重启。
5. **观察**（仅 active 运行期间）：`tools/post-execute` 上分类 external-subagent 调用（spawn 取 profile/agent_id/prompt 首行/报告路径提示并按角色计数；wait/result 更新状态与终态；close 标记回收）与 `write`/`edit` 的 `.agent-work/` 写入（plan/reviews/handoffs）。观察失败静默，绝不破坏工具调用；不观察 ES profiles 目录。
6. **账本合同**：`sfd-run.json` 插件独写、原子落盘、journaled revision（≤500 条）；schema 永不编码阶段/门禁/预算语义，只记观察事实。agent 永不书写该文件。
7. **注入**（`agent/pre-step`，根 agent）：revision 变化时注入 `[SFD]` 块（运行头、actor 摘要、计数、义务清单、skill 指针）；未消解警告约 6 步后重注入一次；块 = 事实 + 指针，非授权非门禁；与 skill 冲突时以 skill 为准。
8. **义务推导**（观察可得的不变量，措辞为观察而非裁决）：PLAN A→B 两路覆盖未关闭（派发 n/完成 m）；implementer 已派发而完成覆盖 <2 → 警告；实现后提醒冻结候选与 B1 盲审；非终态 actor 等待清单；终态未 close 的回收清单。
9. **`sfd_finish()`**：整个授权计划完成并归档后关闭账本、停止注入；未对账 actor 在返回中点名。中途放弃不调用它（用户决策，账本留证）。
10. **面板**（右侧，guide 40，单页只读 Status）：运行头、actor 表、计数、义务（与注入同源）；ES 状态区（`subagents status --probe`，30s 缓存 + 手动强刷）。无任何配置面。
11. **skill 分发**：随包分发上游 v5.5.2 全量（SFD + code-review 伴侣、assets、scripts）+ DSH 补充（`references/dispatch/dsh.md` 路由表：A=zcode、B=codex、impl_std=`sfd-dsh-impl-std`、impl_large=`sfd-codex-impl-large`；启动批准裁定；工作区决策表；注入块的消费规则）。上游 v5.5.2 已内含启动前批准规则，DSH 版差异仅剩：DSH addendum、dispatch/dsh.md 与 model-routing 的嵌入块。

## 约束

- 插件不读写 ES profiles 目录；profile 由 skill 安装器管理，派发可行性由 agent 按 skill 验证。
- 不用额外一次性 LLM 调用；系统中的模型调用只有主 agent 与它派发的 actor。
- 阈值只有一个可调项：注入警告的重注入步数（当前 6）；预算阈值不进插件。
- JSON 最小化：agent 永不书写大段 JSON；账本由程序独写。

## Out of scope（本版不做，也不预留钩子）

预算硬门禁、advisor 程序化、通知、程序化提交、并行编排、面板配置面。若未来需要，须重开合同。

## 验收记录

- v2 重构（2026-10-29，分支 `redesign/injection-first`）：77 个测试全绿（ledger/observer/obligations/context/tools/rpc/client/i18n/skill-provider/skill-prompts/es-status/slug/project/es-cli）。
