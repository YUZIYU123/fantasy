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
