# dsh-sfd

把 Sectioned Feature Development 深度嵌入 **DeepSeek Harness（DSH）** 的原生开发工作流插件。

任务目标、Section 依赖、审查证据、修复预算和恢复状态由 Host 服务持久保存。模型以有边界的 planner、implementer、reviewer、adjudicator 等角色参与；聊天结束或页面关闭不会代表开发任务完成。

当前版本 **0.1.0**，针对 **DSH 0.2.1-rc.2** 构建和验证。方法来自 [sectioned-feature-development](https://github.com/iBobbyTS/sectioned-feature-development)，角色协议已内置于本仓库，不依赖安装或继续维护原 Skill。

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

## 执行过程

| 阶段 | Host 控制的行为 |
| --- | --- |
| 规划 | Planner 提出 Feature/Section DAG；PLAN A、PLAN B 使用独立上下文，串行审查当前计划 |
| 实施 | 一个任务工作区同时只有一个实施者；依赖 Section 已验收并集成后才释放后继 |
| 候选 | 捕获包含源码、测试、配置、暂存/未暂存修改和非忽略未跟踪文件的完整 Git tree |
| Code A | 始终包含 R01 完整行为基线，并按实际风险选择独立审查视角；有界并行 |
| 裁决与修复 | 逐条裁决 finding；真实检查结果、覆盖范围和适用性共同决定能否继续 |
| Code B | B1 完整盲审当前候选；B2 在同一候选上协调 B1 与 A/closure 证据 |
| 修复闭环 | 材料修复后有针对性的 closure、明确的有效 A 证据复用和新的完整 B1 |
| Feature 验收 | 在共同交付候选上检查组合业务路径、Section 接口和共享约束；可复用适用证据 |
| 交付 | 确认实际源码仍匹配验收候选，然后交付工作区或生成明确授权的提交 |

只有 Host 的证据准入与阶段条件满足后，Run 才会 `completed`。结束对话、返回结构化 JSON、若干个 `clean` 标签或单独一次测试通过都不能跳过这些条件。

## 长任务如何保持连续

- **目标独立保存。** 原始目标、后续需求版本和用户决定不依赖聊天上下文。明确撤销的目标可以退役，其原有修复历史仍然保存。
- **状态只有一个来源。** 原生 storage domain 保存 Run 聚合；界面是该状态的投影，不维护另一个 Markdown 状态机。
- **模型按需工作。** Host 持有真实、通常空闲的 anchor Agent；使用原生 `spawn` 和 `delivery: caller` 收集角色结果，不靠反复唤醒主聊天维持调度。
- **版本区分用途。** 聚合 revision、任务输入版本、控制 epoch 分开。一个 A 报告写入不会让同批其他报告过期；暂停或修订后的旧结果不能自动推进新阶段。
- **输入有边界。** 长历史和大 diff 转为只读证据文件与索引，角色可以精确读取；盲审输入在写入文件前就完成过滤。原始目标不会被静默截断，目标本身过大时会明确停止并要求拆分。
- **预算归属于原始 Section。** 最多五轮材料修复；改名、重新规划或拆成 Subsection 不能获得新的修复额度。基础设施失败使用独立的有限重试规则。
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

所有角色默认继承创建任务时选定的 provider/model/effort。可以在 Host 配置中覆盖特定角色，使用当前 DSH 中已经配置好的真实 provider/model ID：

```yaml
- id: dsh-sfd
  config:
    actorTimeoutMs: 1800000
    maxParallelReviews: 3
    maxInfrastructureRetries: 1
    allowCommits: true
    modelRoutes:
      reviewer-b:
        provider: <your-configured-provider-id>
        model: <your-configured-model-id>
    # 与原 SFD 的 impl_large 路由对应，供实施等级为 large 的 Section 使用：
    largeImplementerModel:
      provider: <your-large-provider-id>
      model: <your-large-model-id>
```

路由固定在 Run policy 中，actor 结果不能更改模型或角色 preset。执行记录区分请求路由与实际请求头观察到的路由，缺失观察时不会伪造模型身份。`standard/large` 使用同一个原生实施者 preset，但可按 Section 等级选择不同的 Host 授权模型路由。未指定 large 专用模型时沿用标准 implementer 路由。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm pack --ignore-scripts
node scripts/verify-package.mjs
```

测试包括纯状态机回归、真实临时 Git 仓库与检查进程、组合工作流、真实 Cordis/DSH 服务与原生 spawn/结构化输出、UI 控制器与服务端渲染。模型判断使用确定性的测试提供方；这些测试不代表已对真实付费模型的规划与审查质量做基准测评。CI 使用 Node 24，并验证提交的 `lib/` 与源码一致。

参见 [实施计划](docs/IMPLEMENTATION-PLAN.md)、[架构与不变量](docs/ARCHITECTURE.md)、[验证记录](docs/VALIDATION.md)。

## 当前支持边界

针对 DSH `0.2.1-rc.2`、已有初始提交的普通 Git 仓库和 Bash 兼容的受沙箱约束的检查环境实现。Submodule 的独立工作树、会改变源码内容的 checkout filter、跨多个 Host 自动接管，以及旧 SFD Markdown 状态的自动导入不在当前版本范围内。持久状态拒绝不匹配的 schema、workflow 和 policy 版本；角色协议或权限 preset 的定义变化尚无独立迁移机制，升级这些定义前应先处理活动 Run。

MIT，保留原仓库许可证。
