# SFD → DSH 插件化改造设计 v2

> 需求权威见 [REQUIREMENTS.md](REQUIREMENTS.md)（grill-me 面谈收敛，2026-10-22；启动阶段去程序化修订 2026-10-27；自动激活批准时机修订 2026-10-28）。本文件是实现设计；与合同冲突时以合同为准。

## 1. 与 v1 的关键差异

- 全部 actor 走 external-subagent（无 native subagent）：A 侧 zcode/glm-5.3/max，B 侧与 impl_large 走 codex，impl_std 走 zcode/deepseek-flash。
- 砍掉全部 LLM 决策步与额外 subagent；触发 = 人命令或主 agent skill 式识别。
- 单命令 `/sfd`（无子命令、无 import）；启动时自动探测状态文件并分流 新流程/接手。
- **启动阶段去程序化（2026-10-27）**：工作区准备（脏区处理、基线决策、建分支）由主 agent 按流程 skill 中的强制决策表自行完成；`sfd_start` 不执行任何 git 操作，只读探测 git 事实并落盘状态。
- 提交全部程序化经 `ctx.gitCommit`（重试 1 次 → 降级主 agent）；主 agent 不再决定提交时机，只判 impl 成败。
- impl 判定与 review 面选择合并为一个决策点。
- 全流程零并行（A 组 lens 串行）。
- advisor = 打包+通知后整体挂起，无等待提醒；不用 DSH goal。
- JSON 最小化：仅 `sfd-state.json`（程序独写）；一切报告/HANDOFF/TASK 为 markdown。
- 失败协议明确区分：基础设施故障（插件自动 continue/重试/飞书阻塞）vs agent 循环（主 agent observe 管理）。
- skill 重写：删流程叙述，语义权威保留，阶段内容注入。

## 2. 架构

```
┌─ Host (index.js) ────────────────────────────────────────────┐
│ sfd 状态机服务（单例，串行迁移，原子写 .agent-work/sfd-state.json）│
│ 启动: 只读 git 事实探测（分支/基线/脏否）；工作区准备由主 agent    │
│   按 skill 强制决策表自理，sfd_start 不做任何 git 操作            │
│ 派发引擎: external_subagent ES 任务封装                        │
│   · spawn（plan 只读模式 / build）、prompt 内联文件内容          │
│   · 故障协议: queue-continue → 5min → 重试 → 飞书+阻塞          │
│   · 路由覆盖参数（人指示"用某配置重启"）                          │
│ 工具面: sfd_* 工具集（见 §4）                                  │
│ 命令: /sfd（唯一；无状态→交接含决策表指引，有状态→注入接手简报）   │
│ 集成: ctx.gitCommit（COMMIT 阶段提交）、fetch（飞书 webhook）    │
│ 脚本: section_plan.py / advisor_pack.py / archive_plan.py 复用 │
├─ Client (client.js) ──────────────────────────────────────────┤
│ 右侧栏 tab（sidebarRight.tabs.register kind:'sfd'）             │
│  · 进度树 + holds 横幅 + 运行中 actor                           │
│  · external-subagent 状态区（未装→安装命令；装→状态）             │
│  · sfd profile 安装/更新按钮（显式动作）                         │
│ 数据: Host sfd follow Remote 流                                │
├─ Skill（随 bundle）───────────────────────────────────────────┤
│ 重写后的语义权威（规划方法/准入标准/边界/验收）                    │
│ + 启动前准备的强制决策表；自动激活须先获用户启动批准                     │
└───────────────────────────────────────────────────────────────┘
```

## 3. 状态机与数据

- `sfd-state.json`：阶段（CLEANUP→PLAN→PLAN_REVIEW→IMPL→COMMIT→CODE_REVIEW→ACCEPT→ARCHIVE）、每 unit 进度、review 槽、wave 计数、holds、actors（含 ES agent_id↔unit 映射、路由、重试计数、报告路径+哈希）、git.authority（agent 上报分支 + 探测到的基线/脏否/detached/midMerge 事实）、userDecisions。原子写，先落盘后副作用。
- `.agent-work/` 布局沿用原 skill（REQUIREMENTS/PLAN-FULL/sections/handoffs/reviews/evidence/advisor/archive），全部 markdown。
- FEATURE-STATE.md 由状态渲染（派生视图）。
- 接手对账：ES result/close 逐个核对；无报告=failed/cancelled（有界重试）；漂移→阻塞+选项。
- 会话唤起注入：actor 终止后把报告内容直接带回主会话消息（附报告路径），不再要求读取。

## 4. 工具面（模型可见）

按 agent-experience 原则：少而窄、参数带语义、错误即门禁说明。

| 工具 | 职责 | 决策归属 |
|---|---|---|
| `sfd_start(taskSummary, slug?, branch?)` | 启动落盘：ES 检查、只读探测 git 事实、写初始状态。工作区准备（决策表）由主 agent 在调用前自行完成 | 程序（事实记录） |
| `sfd_plan_validate` | PLAN-FULL 结构校验 | 程序 |
| `sfd_plan_review_run(slot)` | 派发 plan A/B reviewer（串行）、等待回收、计数 | 程序 |
| `sfd_findings_pending` / `sfd_findings_admit` | 待准入清单（含拼接证据）/ 准入落账 | 主 agent |
| `sfd_task_prepare(unit)` | extract + 渲染 TASK，附上下文注入 | 程序 |
| `sfd_task_confirm(unit, verdict, additions?, review_lenses?)` | 一次性决策：放行/补充（程序合并）；impl 完整判定+review 面合并点 | 主 agent |
| `sfd_dispatch_impl(unit, route_override?)` | ES 派发 implementer、故障协议、HANDOFF 回收 | 程序 |
| `sfd_code_review_run(section, lenses?)` | 冻结候选、串行派发 A lens 组、closure、B1（盲审 prompt 构造）/B2 | 程序 |
| `sfd_dispatch_repair(section, batch, route_override?)` | 修复派发（wave 计数+门禁） | 主 agent 定批次 |
| `sfd_advisor_trigger` | 冻结→诊断渲染→打包→飞书→挂起 | 程序（阈值自动） |
| `sfd_hold` / `sfd_release` | 挂起/恢复（含 advisor 结果恢复） | 主 agent/人 |
| `sfd_archive` | 清单式归档 | 程序+主 agent 确认 |

门禁为硬拒绝：越序调用返回结构化错误（当前阶段、缺什么、允许动作）。

## 5. ES 派发引擎要点

- spawn：zcode/codex 均用 plan（只读）模式给 reviewer；build 模式给 implementer；不携带非空 write_manifest。
- prompt 组装（程序）：角色指令（对应原 sfd-* profile 的 developer instructions）+ 内联文件内容（合同/上下文，附路径+"仅遗忘主干时重读"）+ 任务正文 + 报告落盘路径约定。
- 等待：`external_subagent_wait` 循环；终止后 `external_subagent_result` 取报告 → 落 `.agent-work/reviews|handoffs/` → close。
- 故障协议（仅基础设施故障）：wait 返回失败 → queue-continue；再失败 → 5 分钟（`ctx.timer`）→ 重试；仍失败 → 飞书 + BLOCKED。启动失败 → 5 分钟 → 重试一次 → 飞书 + BLOCKED。每次尝试落状态。
- 路由覆盖：`route_override` 参数（subagent/model/effort/profile 名），落账 requested vs actual（沿原 skill 记账要求）。
- profile 管理：面板按钮显式安装/更新 sfd-* profile（源 = 原仓库 agents/*/external/ JSON）；缺失时启动报错并列出确切配置。

## 6. Skill 与上下文注入体系

三个成分，职责互斥：

1. **流程 skill（唯一，随 bundle）**：沿用名 `sectioned-feature-development`，frontmatter 描述改写为插件化流程（触发条件不变：非平凡、跨 owner、状态/接口影响）。内容：阶段模型、每阶段主 agent 职责与判定标准、sfd_* 工具面、门禁语义、失败/接手协议、如何读注入状态，以及**启动前工作区准备的强制决策表**（脏区/基线/退化状态；2026-10-27 起）。**启动与接手的第一步都是读它**。
2. **注入上下文（程序生成）**：只含当前状态快照——阶段/unit、开放 findings、预算余量、待决策项、拼接证据内容、skill 引用。绝不含整体流程描述；agent 忘流程自己重读 skill。
3. **知识库（planning references，随 bundle，基本不动）**：由流程 skill 按阶段引用（如规划阶段给路由目录），本体 agent 自行 read，不经插件专门流程。

配套要求：
- 旧 skill 的流程性文件（reviewer-orchestration/artifact-lifecycle 等 protocol 叙述）不随 bundle 分发、不留在技能面内；语义规则（准入分类、边界、验收标准）抽取为独立知识文件由流程 skill 引用。
- 原 companion `code-review` skill 同样处理：DELEGATED_PASS 语义保留为 reviewer 角色 prompt 的一部分（ES profile 的 developer instructions），不再作为独立 skill 面。

### 阶段注入对照

| 时机 | 注入内容（状态 + 证据，无流程） |
|---|---|
| `/sfd` 启动 | ES 检查结果、启动准备决策表指引（skill 强制版摘要） |
| 接手简报 | 阶段/unit 快照、actors 对账结果、开放决策、预算余量、skill 引用 |
| plan review 准入 | A/B 报告内容、待准入 finding 清单（带 ID）、拼接证据 |
| impl 判定 | TASK、HANDOFF、diff stat、检查结果、（合并决策点）review 面请求 |
| code review 准入 | 报告内容、finding 清单、lens 状态、wave 余量 |
| advisor 触发 | 诊断包路径、通知结果、挂起原因、恢复指令入口 |

## 7. 侧栏面板

- 注册 `kind:'sfd'` tab：`sidebarRight.tabs.register` + `sidebar.right.pane.tab`（key=插件 id）+ title 座。
- 内容：进度树（Feature→Plan review A/B 波数→Section→[impl ✓/◐、A lens 组、findings open/closed、waves x/5、B1/B2]→subsection checkpoint）、HOLDS 横幅（WAITING_USER/WAITING_EXTERNAL/BLOCKED+原因）、运行中 actor 行（ES agent_id、路由、已运行时长、最近活动）、ES 状态区、profile 管理按钮。
- 数据：Host follow 流推送状态快照；有 active SFD 自动展开（`ctx.layout.openRightbar`）。
- 主题 token + zh/en locale。

## 8. 本土化保留项（已确认）

审批协同（Host 服务绕开沙箱反复批准）；i18n；`ensure_agent_work_untracked` 内置；阈值进 Config；飞书默认关。

## 9. 风险与待验证

- ES 任务实际失败信号 vs 语义失败的区分（wait 的 failure_message 解析）→ 首版保守：无法分类即按基础设施故障走协议并告知主 agent。
- zcode/codex plan 模式只读承诺的实际边界（原 skill 已有纪律：mode 标签≠隔离）→ 保留"程序在派发前后校验工作区无漂移"的检查。
- dsh-git-commit 的 status/commit 在各仓库形态下的返回差异 → 启动检查时探测。
- 5 分钟等待用 `ctx.timer`，不阻塞 Host 事件循环；等待期间状态机标 WAITING_RETRY 展示于面板。

## 10. 分期

- **P0**：Host 骨架+状态机+`/sfd` 探测分流+`sfd_start` 只读探测落盘（工作区准备为 skill 强制决策表，agent 自理）+ES 检查。
- **P1**：plan 校验/review 编排+准入工具+TASK 生成/确认+impl 派发+故障协议。
- **P2**：code review 编排+wave 门禁+B1/B2+advisor+飞书。
- **P3**：侧栏面板+接手对账+归档。
- **P4**：流程 skill 重写+阶段注入打磨+profile 管理按钮；旧流程文件下线与迁移检查。
