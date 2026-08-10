# 工程约束

## 技术栈

- Node.js `>=22.13.0`、TypeScript、React、vinext。
- 运行于 Cloudflare，使用 D1、R2 和 Drizzle ORM。
- 统一使用 `pnpm`。仅在依赖变化时更新 `pnpm-lock.yaml`，不要修改 `package-lock.json`。

## 模块边界

- `app/`：页面、布局、页面交互及 API 路由等 HTTP 边界。
- `lib/`：与框架无关的业务类型、规则和校验。
- `db/`：Drizzle schema、数据库连接及持久化逻辑。
- `worker/`：Cloudflare Worker 入口。
- `tests/`：自动化测试；`public/`：静态资源。
- 页面专用代码就近放置；仅将跨页面复用或与框架无关的逻辑抽为公共模块。避免重复抽象和无意义拆分。

## 深模块与 seam

- 业务规则必须集中在拥有该规则的深模块中：创作状态、审核、发布与版本属于 `CreationLifecycle`；素材归属、生成、引用、删除与频控属于 `AssetLifecycle`；阅读推进、分页、媒体时序、终端反馈与进度属于 `ReadingSession`；账号安全流程属于 `AccountLifecycle`；请求身份与即时权限属于 `SessionAuthorization`。
- HTTP route 只能解析请求、获取 actor、调用模块 interface 并映射响应。不得在 route 中编排业务状态转换、Drizzle 查询或事务、所有权判断、校验组合、版本分配、重试或失败补偿。
- React 只能渲染 state、发送 event、执行 effect 并将成功、失败或超时结果回送模块。不得在 hooks 中编排剧情推进、选择锁定、媒体恢复、进度冲突或音乐时序。
- 新增功能时，先通过对应模块的 interface 编写失败测试，再实现模块，最后修改 HTTP 或 React adapter，并删除被替代的旧逻辑与过时测试；生产调用方和测试必须穿过同一个 interface。
- 交付前执行 deletion test：删除模块后，复杂度应重新散回多个调用方；若复杂度直接消失，该模块可能只是浅层转发。业务规则必须只有一个实现来源，修改规则不应要求同步修改 route、React 和模块。

## 功能开发流程

- 每项功能先在 GitHub Issue 中明确 actor、行为、成功结果、拒绝条件与失败恢复，再从最新远端 `main` 创建独立功能分支；架构重构、功能开发和无关修复不得混入同一个 PR。
- 实现前先确认规则所有者并扩展其 module interface。调用方只表达领域意图，不得了解状态限制、校验顺序、事务、版本分配、重试或补偿等 implementation 细节。
- 按 TDD 顺序交付：通过正式 interface 编写失败测试，完成最小 module implementation，再连接 HTTP 或 React adapter，最后删除被替代的旧实现；不得让新旧规则长期并存。
- 每个 PR 只承载一个可独立验收的功能，至少覆盖成功、拒绝、越权和失败恢复路径；合并前运行相关测试、`pnpm lint`、按本文件要求运行 `pnpm test`，并执行 Standards 与 Spec 双轨 code review。
- 功能应先部署到使用独立 D1/R2 的 Preview 环境验收，再合并到 `main`；正式发布必须遵守本文件“发布”章节的 GitHub 上游、干净工作区和提交一致性要求。

## 修改原则

- 保持改动最小，沿用严格 TypeScript 和现有代码风格；不要覆盖或清理无关的未提交修改。
- 不直接编辑 `dist/`、`.next/`、`.vinext/`、`.wrangler/` 等生成目录。
- 数据库结构变更须同步 `db/schema.ts`，运行 `pnpm db:generate` 并检查生成迁移；不要随意手改迁移产物。
- 不提交密钥或 `.env*`。不得削弱管理接口鉴权，也不得创建平台保留的 ChatGPT 登录、登出或回调路由。

## 阅读体验

- 读者端以手机端为唯一设计基准；桌面端也应保持居中的手机阅读视口，不得改成宽屏布局或改变移动端的信息层级、交互和阅读节奏。
- 创作与管理后台不受上述限制，但仍须保证手机端基本可用。

## 发布

- 发布前必须执行 `git fetch --prune origin`，以当前分支的 GitHub 上游分支为发布来源；不得仅依据陈旧的本地远端引用判断代码已同步。
- 只允许发布已经存在于 GitHub 远端的提交。发布时工作区必须干净，且本地 `HEAD` 必须与目标远端提交完全一致；未提交或尚未推送的本地代码不得直接发布。
- 发布完成后须报告 GitHub 仓库、远端分支、完整提交哈希和 Cloudflare Worker 版本，并验证线上自定义域名确实运行该次构建。

## 验证

- 普通代码修改运行 `pnpm lint`。
- 涉及运行时、API、数据库或构建链时运行 `pnpm test`。
- 如遇与本次修改无关的既有失败，保留现场并在交付时明确说明。

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical labels without overrides. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
