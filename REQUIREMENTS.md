# SFD → DSH 插件：需求合同（Requirements Contract）

由 grill-me 面谈收敛，2026-10-22。本文件是唯一需求权威；设计细节见 DESIGN.md（v2）。

## Goal / success condition

把 sectioned-feature-development（v5.5.1）改造为 DSH 持久插件：Host 状态机接管记账/派发/调度/门禁/通知，主 agent 只做语义判断，Client 侧栏提供进度与 external-subagent 状态可视化。成功条件：从头启动与任意阶段中断后新会话接手均可继续执行；原 skill 方法论保障（独立 A/B 覆盖、wave 预算、advisor 升级、盲审隔离）不降级。

## Actors 与路由（全部走 external-subagent，无 native subagent）

| 角色 | 路由 | 备注 |
|---|---|---|
| plan review A / code review A | ES zcode / glm-5.3 / effort=max | 需在 ES 建好对应 profile |
| plan review B / code review B / impl_large | ES codex | 沿用原 sfd-codex-* profile |
| impl_std | ES zcode / deepseek/deepseek-flash | spawn 显式 provider/model token，无需命名 profile |
| 主 agent | 会话本身 | 语义判断、准入、验收 |

- 不用任何额外的一次性 LLM 分类调用；系统中的模型调用只有主 agent 与上述 actor。
- Reviewer 以 ES 只读权限模式派发（zcode/codex 的 plan 模式）；不携带非空 write_manifest。
- 人可指示"用 external-subagent 的某某配置重启"：重派工具接受路由覆盖参数。
- 插件面板提供"安装/更新 sfd-* profiles"显式按钮（不静默写 ES 配置目录）；缺 profile 时启动报错并给出确切配置内容。

## Required user-visible behavior

1. **单一命令 `/sfd`**，无子命令：
   - 无任何 SFD 工作状态文件 → 新流程，从 git 工作区检查开始；
   - 存在状态文件 → 把接手简报注入当前 agent；可能是接手中途任务，也可能是上次未清理干净，由主 agent 决策（继续 / 归档 / 问用户 / 按用户指示）。
2. **激活路径**：人工 `/sfd` 或口头；或主 agent 识别请求符合 SFD 触发条件后自行启动（skill 式识别，无额外 LLM 调用）。**仅 agent 自动激活时**，第一个成比例计划须用户卡片批准后才进 plan review；显式激活跳过此暂停。
3. **开始前清理**（决策表，全部程序化 + 卡片）：
   - 工作区脏 → [停止 | 自动提交（dsh-git-commit AI 消息）| 输入框手写提交消息]；
   - 干净且在 main → 自动建 feature branch（名字来自 feature slug，卡片确认可改）；
   - 干净且不在 main，按 ahead/behind：
     - 0/0 → [停止 | 在当前分支工作 | 开新分支工作]
     - ahead>0,behind=0 → [停止 | 当前分支 | 从当前分支开新分支 | 从 main 开新分支 | 先把 main fast-forward 到当前分支再开始]
     - ahead=0,behind>0 → [停止 | 当前分支继续 | 从当前分支开新分支 | 从 main 开新分支 | fast-forward 到 main | 输入框手写 merge commit]
     - ahead>0,behind>0 → [停止 | 当前分支 | 从当前分支开新分支 | 从 main 开新分支 | agent 执行合并并解决冲突（转主 agent 任务）]
   - 每个动作执行后重验证；无 main 引用/merge 进行中/detached HEAD → 通用询问卡片。所有选择原文落账。
4. **规划**：PLAN-FULL 由主 agent 撰写（模板+知识库目录由插件按阶段注入；知识库本体 agent 自行读取）；写完后程序结构校验（section_plan.py），保证后续 section 提取必然成功。
5. **Plan review**：串行 A→B；material 修正波计数，≥2 自动 hold 进入诊断（硬门禁）；finding 准入由主 agent（插件呈递待准入清单，含程序拼接好的证据文件内容，省去多次读取）；修正后有界 PLAN_DELTA 复查；两个覆盖关闭前禁止派发 implementer（硬门禁）。
6. **TASK 生成与派发**：程序 extract TASK；主 agent 一次性决策（放行，或把补充内容写在回答里，**由程序合并进 task 文件**；主 agent 不改文件）；依赖 section 未接受则拒绝派发（硬门禁）。
7. **Subagent prompt 内联**：派发时把要求阅读的文件内容直接放进 prompt（附路径+"仅遗忘主干时重读"）；actor 终止后，程序把报告落盘 `.agent-work/reviews|handoffs/`，并把报告内容直接注入主会话唤起消息（不要求主 agent 再读文件）。
8. **Impl 判定与提交**（一个决策点）：
   - 程序先跑确定性门禁（终态结果、HANDOFF 必填、声明的检查、diff 未越出 scope manifest）；
   - 主 agent 同一步判断：impl 是否完整 + review 面选择（首次由主 agent 按风险路由定，之后同 section 复用）；
   - 判定通过 → 程序调用 `ctx.gitCommit.commit()`（AI 消息）；失败重试 1 次；仍失败降级主 agent 手工提交。
   - 语义返工由主 agent 自行决策（小概率），用新鲜上下文重派。
9. **Code review 编排**（全程零并行）：lens 串行逐个派发→等待→回收；wave 计数 5/section（硬门禁）；closure verify 按已定 lens 面程序化派发；B1 盲审 prompt 由插件构造（不含 A 结论/修复史）；B2 同候选核验。finding 验证、聚类、准入、闭合裁决均主 agent；程序提供拼接好的证据包。
10. **Advisor**：触发 → 冻结 → 渲染诊断 → `advisor_pack.py` 打包 → 飞书通知 → **整个流程挂起**（不做等待提醒）。用户把结果带回主 agent，主 agent 决定下一步并恢复任务。
11. **Actor 失败协议**（"运行失败"= 网络/MCP 链路等基础设施故障）：
    - 运行失败 → 向该任务 queue 发 continue；第二次失败 → 等 5 分钟再试；仍失败 → 飞书通知人并**阻塞全流程**；
    - 启动失败 → 等 5 分钟重试一次 → 仍失败 → 飞书通知 + 阻塞；
    - agent 陷入无意义循环**不是**故障：由主 agent 用 observe 工具管理，插件只在面板如实展示运行/无进展事实；
    - 阻塞期间一切派发工具硬拒绝；人可通过路由覆盖参数指示重启。
12. **中断与接手**：每个阶段中断都可在新会话接上；`sfd-state.json` 记录 ES agent_id↔unit 映射，接手时逐个 result/close 对账；状态声明已派发但无报告的 actor 归为 failed/cancelled，按有界重试规则处理；状态漂移（plan 哈希/分支/HEAD 不符）→ 阻塞并给选项。
13. **侧栏面板**：SFD 进度树（plan / plan review / feature / section / subsection / code review / waves / holds 横幅 / 运行中 actor 行）+ external-subagent 状态区（未安装显示安装命令；已安装显示状态）。**ES 未安装时启动 SFD 直接报错**。有 active SFD 时面板自动展开。不加命令；不用 DSH goal。
14. **JSON 最小化**：agent 永不书写大段 JSON；JSON 仅用于状态表达（`sfd-state.json`，程序独写独读）；REQUIREMENTS/PLAN-FULL/TASK/HANDOFF/review 报告全部 markdown。
15. **Skill 与上下文重设计**（三个成分，职责互斥）：
    - 原 skill 的流程性叙述全部移除（调度/计数/顺序/派发由插件接管），且**不得残留任何可能让 agent 误按旧流程执行的描述**——旧流程文件不随 bundle 分发、不留在 agent 可发现的技能面内；被保留的语义规则改写为独立知识文件。
    - **唯一的流程 skill** 描述插件化后的整体流程：阶段模型、各阶段主 agent 的职责与判定标准、对应 sfd_* 工具、门禁含义、接手方式。沿用原名称（`sectioned-feature-development`），使"用 SFD"的口头触发与 DSH 技能目录识别自然落到新流程上。
    - **启动与接手的第一步都是读该 skill**（`/sfd` 的启动注入与接手简报均以"先读流程 skill"开头）。
    - **注入上下文只含当前状态**：阶段、当前 unit、开放 findings、预算余量、待决策项、拼接好的证据内容、指向流程 skill 的引用。**整体流程描述永不出现在注入内容里**——agent 忘记流程时自己重读 skill。
    - 知识库（planning references）基本不动，由流程 skill 按阶段引用，agent 需要时自行读取，不经插件专门流程。

## Constraints

- 阈值（plan 2 material waves / code 5 waves / 重试次数）进插件 Config，不写死。
- 飞书 webhook 默认关闭；通知范围：actor 终态失败 + advisor 触发；里程碑通知默认关。
- 插件动作（commit/branch）走 Host 服务，不受会话沙箱反复批准干扰。

## Out of scope

并行执行与 worktree 管理；DSH goal 机制；旧（非插件）运行记录的 import；native subagent；额外 LLM 决策步；`/sfd` 子命令。

## Acceptance criteria

1. `/sfd` 在干净仓库走完 规划→review→impl→提交→code review→验收 全流程，面板全程反映真实状态。
2. 任意阶段杀会话 → 新会话 `/sfd` 出接手简报，对账后从正确断点继续，无重复已完成的 review/impl。
3. ES actor 被人工终止/网络失败 → 按协议自动续跑；超限后飞书收到通知且全流程阻塞。
4. material wave / 5-wave / 依赖未接受 / 双覆盖未关 等门禁被越序调用时，工具返回明确错误而不是放行。
5. `sfd-state.json` 是唯一机器状态；markdown 报告齐备可人读。
6. 任意接手点仅凭「流程 skill + 注入的当前状态」即可正确继续；注入内容不含整体流程描述；旧 skill 流程文本不出现在 agent 可读面内。

## Confirmed human decisions

B 侧路由=维持原 skill（ES codex）；提交=程序经 dsh-git-commit（重试1次→降级主 agent）；首次计划批准=仅自动激活要批；5 条自采假设（queue-continue、返工新鲜上下文、面板自动展开、agent_id↔unit 对账、飞书三行模板）全部确认；impl_std 改 ES zcode deepseek/deepseek-flash。

跨仓 section（2026-10-23 裁决，同日补充，替代更重的"卫星仓"模型）：PLAN-FULL 的 section 契约增加可选 `- Repository:` 字段，缺省=当前仓库；填了则该 section 的实现落在该仓库。SFD 状态与全部工件只存主仓库 `.agent-work/`，不向外部仓库写入 `.agent-work/`（外部仓现存的 `.agent-work/` 不属于本流程，保留不动）。声明 Repository 即跳过程序对该仓库的一切 git 管理：清理门、漂移对账、程序化提交均不覆盖外部仓库，其分支与提交由主 agent 自行管理，无需用户额外授权。程序改动仅限：plan 结构校验接受该字段并校验路径为存在的 git worktree、TASK extract 原样携带。规则不含发布/发版相关内容。

## Planner discretion

reviewer 只读的具体实现（ES plan 权限模式 vs prompt 约定）；状态文件 schema；面板视觉；profile 安装按钮的交互细节；gitCommit 调用参数。

## Unresolved blockers

无。
