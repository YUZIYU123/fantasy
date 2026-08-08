# 幻界 Fantasy · 互动小说发布器

面向手机读者的多小说互动播放器，以及带读者、作者、管理员三种角色的小说／章节创作与审核后台。项目直接运行在 Cloudflare Workers，使用 D1 保存账号、进度、小说、章节与素材元数据，R2 保存图片／音频／视频，不使用 Sites。

## 技术结构

- `/`：公开小说书架、小说主页、章节目录与互动阅读器，只读取已发布版本。
- `/api/novels`：公开、只读的已发布小说及同书章节目录。
- `/api/chapters`：公开、只读的已发布章节接口，支持按 `novelId` 过滤。
- `/api/assets/:id`：公开 R2 素材读取接口，支持视频 Range 请求和长期缓存。
- `/register`、`/login`、`/account`：读者注册、登录、资料和云端阅读进度。
- `/studio`：作者自己的小说资料、章节设置、流程画布和素材库；作者只能提交审核。
- `/admin`：管理员小说／章节审核、发布、回退、用户角色和全部素材管理。
- `/admin/api/*`：使用单创作者密码会话或站内管理员账号鉴权，不依赖 Cloudflare Access。
- `wrangler.jsonc`：唯一 Cloudflare 部署配置，包含 Worker、D1、R2 和观测配置。

## 本地开发

需要 Node.js `>=22.13.0` 和 pnpm。

```bash
pnpm install
pnpm cf:types
pnpm db:migrate:local
pnpm dev
```

如需在本机打开后台，新建不会提交到 Git 的 `.dev.vars`：

```dotenv
LOCAL_ADMIN_BYPASS=true
LOCAL_AUTH_BYPASS=true
TURNSTILE_SITE_KEY=your-turnstile-site-key
APP_ORIGIN=http://localhost:3000
# 可选：本地测试 AI 音效生成时再加入，不要提交真实密钥
SFX_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your-elevenlabs-api-key
```

`LOCAL_ADMIN_BYPASS` 和 `LOCAL_AUTH_BYPASS` 只在请求主机为 `localhost` 或 `127.0.0.1` 时生效；生产环境不要设置。

## Cloudflare 初始化与部署

1. 在 Cloudflare 创建或确认 `mist-page-fiction-db` D1 数据库与 `mist-page-fiction-assets` R2 Bucket。它们沿用旧资源名以保证线上数据兼容，不随品牌更名。
2. 将 `wrangler.jsonc` 中的 `database_id` 和资源名称改为目标环境的真实值。
3. 生成高强度创作者密码并计算 SHA-256 十六进制摘要，同时生成至少 32 字符的随机会话密钥，然后保存为 Worker 加密变量：

```bash
pnpm exec wrangler secret put CREATOR_PASSWORD_HASH
pnpm exec wrangler secret put CREATOR_SESSION_SECRET
```

创作者访问 `/admin` 后输入密码，服务端签发仅限 `/admin`、`HttpOnly`、`SameSite=Strict` 的 30 天会话 Cookie。创作者也可以把已验证的站内账号升级为管理员，之后使用该账号访问后台。

4. 配置注册邮件和 Turnstile。以下值使用 `wrangler secret put` 保存，不要提交到仓库：

```bash
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put AUTH_FROM_EMAIL
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
pnpm exec wrangler secret put ELEVENLABS_API_KEY
```

同时配置普通变量 `APP_ORIGIN` 和 `TURNSTILE_SITE_KEY`。`wrangler.jsonc` 已将 `SFX_PROVIDER` 设为 `elevenlabs`；ElevenLabs 密钥只保存为 Worker Secret，绝不能提交到仓库或返回前端。Resend 发件地址必须已在 Resend 中验证。

5. 应用远程迁移并部署：

```bash
pnpm db:migrate:remote
pnpm deploy
```

这些远程命令需要具备目标 Worker、D1 和 R2 权限的 `CLOUDFLARE_API_TOKEN`。发布前可先运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 现有 D1 数据升级

升级前先导出备份：

```bash
pnpm exec wrangler d1 export mist-page-fiction-db --remote --output backup-before-media-v2.sql
```

- 如果数据库已有 Wrangler 的 `d1_migrations` 记录，直接运行 `pnpm db:migrate:remote`。
- 如果业务表已存在但没有迁移基线，不要直接运行会重复建表的 `0000`。创建 v2 D1，先应用完整迁移，再导入旧备份并切换 `wrangler.jsonc` 的绑定。
- R2 对象无需搬迁。旧素材 URL 仍可读取；素材删除时会从旧 URL 回填实际 `storageKey`。新上传素材统一使用稳定的 `/api/assets/:id` 地址，移动文件夹不会改变 URL。

远程迁移和绑定切换应在维护窗口执行，并在切换前核对章节数、版本数、素材数和随机素材读取结果。

## 内容与素材约束

- 图片上限 8MB，音频上限 20MB。
- 视频仅支持 MP4/WebM，单文件不超过 50MB、60 秒；Worker 不负责转码。
- 视频模式为无视频、静音循环背景或独立过场，三者互斥。
- 发布会校验断链、孤立节点、循环、可达的章节结束入口及失效／类型错误的素材引用。
- 被草稿、线上版本或历史版本引用的素材不可删除；未引用素材先进入删除状态，再同步删除 R2 对象和 D1 元数据。
- 小说封面与章节收尾图由作者自行上传；仓库不预置任何具体小说图片或故事内容。
- “小说管理”独立配置小说名称、简介、封面、审核和版本；“章节设置”只管理章节名称、简介、可选开场图和统一收尾图。
- 小说封面、章节开场／收尾图、场景背景和节点图片页均可独立选择完整显示或铺满裁切，并保存画面焦点。
- 节点可在正文前或正文后插入一张独立全屏图片页；该图片与场景背景图互不影响。
- 音乐编排按开始节点和多个停止节点定义播放区间，跨普通节点不重播；新配乐使用淡入淡出替换。
- 任意节点均可同时配置剧情选项和“结束本章”入口。
- 每条选择可设置六种转场，并选择在当前节点之后或目标节点正文之前播放。
- 正文移动端为 19px，每页自动控制在约 180–240 个可见字符，也可用 `[[PAGE_BREAK]]` 手动分页。
- 草稿可缺少封面与收尾图；提交审核或发布时必须补齐图片和替代文本。
- 进入统一收尾页后章节记为完成，再次阅读从起始节点开始；只有中途退出的记录会作为待续进度展示。
- “幻界终端”悬浮挂件提供登录注册引导、设备端偏好推荐和可爱中性／女声／男声语音；作者可在节点正文开始或最后一页触发系统消息。
