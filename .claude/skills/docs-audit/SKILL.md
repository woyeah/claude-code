---
name: docs-audit
description: Audit CLAUDE.md and docs/INDEX.md consistency against the current repo state. MUST trigger before any commit that touches docs/, CLAUDE.md, or any source file referenced from CLAUDE.md's navigation pointers — even if the user didn't explicitly ask for an audit. Also trigger on "/docs-audit", "docs consistency", "文档一致性检查", "check INDEX.md", "verify CLAUDE.md links", "docs progressive disclosure check", "是否要更新 CLAUDE.md", "要不要更新 INDEX". Produces a three-tier report (must-fix / suggest-fix / OK). This skill NEVER edits files — it reports and recommends; the caller decides what to change.
---

# docs-audit · 文档一致性审计

本 skill 在做完一批改动、**准备 commit 之前**运行，确保 `CLAUDE.md` 与 `docs/INDEX.md` 保持"**渐进式披露**"原则：CLAUDE.md 始终是目录（≤100 行）、INDEX.md 始终是索引（不塞内容）、所有 `docs/**/*.md` 有一条索引 + 一句 hook。

## 为什么存在这个 skill

本项目规则（`CLAUDE.md` 开头明确）：

- CLAUDE.md **是目录不是百科**，硬上限 100 行；超过就要把内容拆到 `docs/` 下
- **新建 / 搬移文档前**先读 `docs/INDEX.md` 确认归属目录（`guides/` 还是 `plans/`）；写完**回来更新 INDEX**
- 根目录只留 `README.md` / `CLAUDE.md` / `AGENTS.md` / `docs/INDEX.md`
- INDEX.md 的每条目：`- [title](path) — one-line hook`

这些规则**靠人/AI 主动遵守**，没有 lint / hook 强制。本 skill 就是那层软强制——每次写完东西走一遍，防止：

1. CLAUDE.md 指针指向已搬走 / 删掉 / 改名的文件
2. CLAUDE.md 悄悄涨到 120 行，变成"什么都往里塞的百科"
3. 新建了 `docs/guides/foo.md` 但忘了进 INDEX，别人再也找不到
4. 设计文档放到 `docs/guides/` 这种错位（guides 是"读后能干活"，plans 是"要往哪里走"）

## 什么时候触发

**必须触发**：
- 用户说 "commit" / "提交" / "要推上去了" / "完事了" — commit 前最后一道闸
- 用户动了 `docs/**`、`CLAUDE.md`、`AGENTS.md`、`README.md` 任何一个
- 用户动了被 CLAUDE.md 明文指向的源文件（`src/main.tsx` / `src/commands.ts` / `src/tools.ts` / `src/QueryEngine.ts` / `src/state/AppStateStore.ts` / `src/remote/RemoteSessionManager.ts`）

**应该触发**：
- 用户问 "要不要更新 CLAUDE.md" / "INDEX 要不要加" / "文档一致吗"
- 斜杠命令 `/docs-audit`
- 做了文档搬移 / 重命名 / 删除

**不必触发**：
- 纯代码改动，且不涉及 CLAUDE.md 的 navigation 指针目标
- 纯配置 / build 脚本改动

## 审计项（7 类）

对每类产出 `🔴 必须修` / `🟡 建议修` / `✅ OK` 之一，附定位 + 建议动作，**不直接改文件**。

### A. CLAUDE.md 链接有效性

- 解析 CLAUDE.md 里所有相对路径链接（`./docs/...`、`../`、`docs/plans/...`）
- 每条用 `Glob` 或 `Read` 校验文件真实存在
- 断链 → 🔴

### B. CLAUDE.md 行数上限

- `Read` 文件，数行数
- ≤100 行 → ✅
- 101–110 → 🟡（提醒收敛，优先把最新加的几行内容迁到 `docs/`）
- >110 → 🔴（必须拆分）
- 同时留意：行数虽然够但**单行过长**（>200 字）说明在堆内容不是在做目录，也算 🟡

### C. CLAUDE.md 指针 vs INDEX.md 指针漂移

- 把 CLAUDE.md "## 导航" / "## 关键入口文件" / "## 按问题定位代码" 等段里指向 `docs/**` 的所有链接提取出来
- 把 INDEX.md 里所有 `docs/**/*.md` 条目提取出来
- **不一致**（CLAUDE.md 指了但 INDEX 没收 / 或相反）→ 🟡；若 CLAUDE.md 指的文件**在 INDEX 压根没提**且不是主索引自己 → 🔴
- 两份文件的一句话描述**语义矛盾**（CLAUDE 说"构建速查"、INDEX 说"部署策略"指同一个文件）→ 🟡

### D. INDEX.md 收录完整性

- `Glob` 扫 `docs/**/*.md`（递归）
- 每一个文件都必须在 INDEX.md 里有对应条目
- 漏收 → 🔴（渐进式披露的主要违反）
- 例外：`docs/INDEX.md` 自己不需要收录自己

### E. INDEX.md 链接有效性

- 与 A 对称：INDEX.md 所有相对链接必须指向存在的文件
- 断链 → 🔴
- 指向目录而非具体文件 → 🟡

### F. 最近 git 改动 × CLAUDE.md 引用

- 运行 `git diff --name-only HEAD~3 HEAD`（或 `--staged`）取最近改动的源文件列表
- 对照 CLAUDE.md 里"## 关键入口文件" / "## 按问题定位代码" 等段落提到的源码路径
- 有重合 → 🟡（提醒复核 CLAUDE.md 里这几行描述是否还准确；不一定要改，但要看一眼）
- 若改动包括文件**删除/重命名** → 🔴（CLAUDE.md 指针必然过期）

### G. 新文档目录归属

- 对最近新增的 `docs/**/*.md`（`git status` + `git diff --stat HEAD~3`），检查目录定位：
  - `docs/guides/` = **架构参考 · 操作指南 · stub / 构建说明 · 工具与流程拆解**（"读后能干活的内容"）
  - `docs/plans/` = **Roadmap · 设计文档 · 二次开发计划 · 里程碑**（"要往哪里走的内容"）
  - 其它子目录（如 `docs/specs/`、`docs/superpowers/`）不应存在（INDEX.md 只承认 guides 和 plans）
- 位置不对 → 🔴，建议移动
- 位置勉强对但语义更贴另一类 → 🟡

## 如何执行

按下面的顺序跑，尽量**并行 Grep / Glob**，不 serialize：

1. **读 3 份源文件**（并行）：`CLAUDE.md`、`docs/INDEX.md`、最近 git status/diff
   - 用 `Read` 读前两个
   - 用 `Bash` 跑 `git status --short && git diff --stat HEAD~3 HEAD`（若仓库不到 3 个 commit 就 `git log --oneline -5` + 全量 `docs/`）
2. **抽取链接**（并行 Grep）：
   - `Grep "\\]\\(\\.?\\./" CLAUDE.md` 抽 CLAUDE.md 链接
   - `Grep "\\]\\(" docs/INDEX.md` 抽 INDEX.md 链接
3. **Glob `docs/**/*.md`** 拿完整文档清单
4. **逐条校验**（可再并行）：
   - 文件是否真实存在（`Glob`）
   - INDEX.md 是否有对应条目（`Grep` 文件名）
   - CLAUDE.md 提到的源路径是否还在（`Glob src/...`）
5. **汇总成三档报告**（见下文格式）

## 输出格式（严格遵守）

```markdown
# 📋 文档一致性审计报告

**审计范围**：<CLAUDE.md + docs/INDEX.md + docs/**/*.md + 最近 N 条改动>
**时间**：<ISO 日期>

## 🔴 必须修（blocking — commit 前处理）

<如无，写 "无">

1. **[类别代号 · 文件:行号]** 具体问题描述
   - 证据：<grep/ls 输出片段>
   - 建议动作：<具体到"把 X 改成 Y" / "把 foo.md 从 a/ 移到 b/"，不要只说"修 INDEX"这种泛泛>

## 🟡 建议修（non-blocking — 可延后）

<同上格式>

## ✅ OK（已验证的项）

- A. CLAUDE.md 链接有效性：N 条链接全部存活
- B. CLAUDE.md 行数：<X>/100
- C. 指针漂移检查：CLAUDE ↔ INDEX 覆盖 N 条，无矛盾
- D. INDEX 收录完整性：`docs/` 下 N 个 md，INDEX 覆盖 N 个
- E. INDEX 链接有效性：N 条链接全部存活
- F. git × CLAUDE.md 引用：最近 N 个改动无重叠 / 或已复核过
- G. 新文档目录归属：N 个新文档位置正确

## 🎯 Commit 就绪评估

- **可以 commit**：所有 🔴 为空
- **不能 commit**：有 🔴 条目，先解决
- **可以但建议**：🔴 空，🟡 非空，是否修由你决定

<如果可以 commit，加一行提示；如果不能，直接点出最关键那条 🔴>
```

## 执行约束

- **绝对不要**调用 `Edit` / `Write` 改 `CLAUDE.md` / `INDEX.md` / 任何文档。本 skill 只报告，修不修由主工作流决定。
- **不要**问用户 "要我帮你修吗" 之类的问题——直接把报告打印出来，主工作流的 Claude 自己会决定下一步
- **不要**建议跑项目里不存在的工具（本项目无 lint / test / prettier）
- 路径一律用**正斜杠**（Windows + bash shell，CLAUDE.md 已明确）
- 证据引用短一点：grep 输出 >3 行就截前 2 行 + `...`
- 如果发现 CLAUDE.md 里新出现了"条文性描述"（不是指针而是解释内容），提示"这条可以迁到 docs/guides/"——但不要写具体该迁到哪份文件里，除非明显

## 示例：一个典型的好报告

```markdown
# 📋 文档一致性审计报告

**审计范围**：CLAUDE.md + docs/INDEX.md + 5 个 docs/**/*.md + 最近 3 个 commit
**时间**：2026-04-24

## 🔴 必须修

1. **[D · docs/guides/new-feature.md]** 新增文件但 INDEX.md 未收录
   - 证据：`docs/guides/new-feature.md` 存在于 `git status`，grep INDEX.md 无 `new-feature` 字符串
   - 建议动作：在 `docs/INDEX.md` 的 "## guides" 段加一行：`- [\`guides/new-feature.md\`](guides/new-feature.md) — <一句话 hook>`

## 🟡 建议修

1. **[F · src/QueryEngine.ts]** 最近被改动，CLAUDE.md 第 38 行有对它的描述
   - 证据：`git diff HEAD~2 HEAD` 含 `src/QueryEngine.ts`；CLAUDE.md:38 写"session-level 状态：mutableMessages、readFileState..."
   - 建议动作：看一眼这次改动有没有增删 session-level 字段，有就同步 CLAUDE.md

## ✅ OK

- A. CLAUDE.md 链接有效性：7 条链接全部存活
- B. CLAUDE.md 行数：98/100
- C. 指针漂移检查：CLAUDE ↔ INDEX 覆盖 6 条，无矛盾
- D. INDEX 收录完整性：`docs/` 下 6 个 md，INDEX 覆盖 5 个 ← 见 🔴 #1
- E. INDEX 链接有效性：6 条全部存活
- F. git × CLAUDE.md 引用：1 条需复核 ← 见 🟡 #1
- G. 新文档目录归属：1 个新文档位置正确（guides/）

## 🎯 Commit 就绪评估

**不能 commit**：🔴 #1 未解决，INDEX.md 缺收录会让新文档不可发现。先补一行再 commit。
```

## 元规则

本 skill 运行时**不应**修改本文件自己，也不应建议添加更多审计项。若用户发现漏审，让用户直接 Edit SKILL.md 加条目，而不是在报告里自我提议。
