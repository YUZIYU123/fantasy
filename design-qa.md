# 小雾精灵化终端 Design QA

## 内容框贴边探头增量（Issue #75）

- 验收日期：2026-09-02
- 右边框镜像探头：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-edge-peek/01-right-edge-peek.png`
- 拖离边框恢复完整身体：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-edge-peek/02-dragged-inside-full.png`

### 结果

- 桌面浏览器以居中的 430px ReaderShell 为活动范围，不再把两侧黑色留白计入可拖拽区域；正式阅读同样使用居中的阅读框。
- 贴左边框显示原方向半身探头；贴右边框使用同一资产水平镜像，容器宽度和可见比例对称。
- 从任一边框向内拖过 12px 阈值后，同一次拖动立即切换为完整身体；再次贴边则恢复对应探头方向。
- 旧版归一化位置偏好会重新映射到内容框并夹紧，右侧旧位置不会停留在桌面留白。
- 360×800、390×844、430×932 均无横向溢出；桌面 1280px 视口下角色始终位于 425–855px 内容框。
- 200% 等效窄视口下对话框保持 8px 横向边距，并在上下空间不足时使用完整安全高度滚动，不会压缩到不可操作。
- 键盘移动、隐藏／唤回、剧情反馈临时现身、作者预览隔离与 reduced motion 行为保持不变。
- Standards 审查以 `origin/main` 为基线，内容框坐标、左右贴边和恢复规则集中在 `companion-placement` interface；React 仅适配 DOM 内容框和输入事件，未发现模块边界或代码异味问题。
- Spec 审查逐项核对 Issue #75，补充了正式阅读在桌面端使用居中手机框的显式回归测试，未发现剩余缺口或范围外改动。
- 最终门禁通过：`pnpm typecheck`、`pnpm lint`、生产构建、176 项模块／HTTP 测试与 75 项 React 测试。

### 最终结果

passed

---

## 可拖拽与隐藏增量（Issue #71）

- 验收日期：2026-09-02
- 隐藏后贴边入口：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-drag-hide/01-hidden-edge.png`
- 拖拽后展开对话：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-drag-hide/02-dragged-dialog.png`
- 浏览器 200% 缩放：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-drag-hide/03-zoom-200.png`

### 结果

- 鼠标、触屏指针均可拖动小雾；拖动超过阈值不会误开对话，位置按视口比例保存在浏览器并同步到同源标签页。
- 键盘聚焦小雾后可用方向键移动；`Shift` 加方向键使用 24px 大步进。移动始终受顶部与 Dock 安全区约束。
- 对话卡会跟随小雾：手机窄视口优先在角色上方或下方展开，宽视口优先左右展开，且始终夹紧在可见区域。
- 对话中的“隐藏”将小雾替换为最近屏幕边缘的具名“唤回小雾”按钮；唤回后焦点回到小雾。损坏或不可写的本地偏好安全回退，不阻断交互。
- 剧情反馈会临时唤出已隐藏的小雾，反馈结束后恢复隐藏；正式阅读仍隐藏 Dock，但保留可移动、可隐藏的小雾入口。`launcher="hidden"` 的作者预览不读取读者偏好。
- 360×800、390×844、430×932 均满足 `scrollWidth === clientWidth`；角色和对话卡没有横向溢出。
- 浏览器 200% 缩放实测 `visualViewport.width = 195`，对话卡保持在 8–187px 可见范围，页面无新增横向滚动。
- `prefers-reduced-motion: reduce` 下角色与对话卡的 `animation-name` 为 `none`、`transition-duration` 为 `0s`。
- Standards 审查以 `origin/main` 为基线，未发现 AGENTS.md 模块边界、移动端约束或代码异味问题；位置计算集中在 `companion-placement`，React 只处理输入事件与视图状态。
- Spec 审查逐项核对 Issue #71，未发现缺失或越界；补充了作者预览不读取／改写读者偏好的显式回归测试。
- 基于最新 `origin/main` 复验通过：`pnpm typecheck`、`pnpm lint`、生产构建、174 项模块／HTTP 测试与 73 项 React 测试。

### 最终结果

passed

---

- 视觉基准：`/Users/yuruby/.codex/generated_images/01a00a04-64ab-7a60-8f2b-913d1eb879a9/exec-732f81dd-8747-4ce7-8597-05095011def8.png`
- 实现范围：标准读者外壳、正式阅读、小雾剧情反馈、360–430px 手机视口
- 基准视口：390×844，DSF 1；补充检查 360×800、430×932 与 200% 有效缩放

## 证据

- 标准外壳展开：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-open-390x844.png`
- 360×800：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-open-360x800.png`
- 430×932：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-open-430x932.png`
- 200% 有效缩放：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-open-effective-200pct-fixed.png`
- 正式阅读待机：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-reader-idle-cropped-390x844.png`
- 正式阅读成功反馈：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/implementation-reader-success-final-390x844.png`
- 完整对比：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/comparison-success-full-final.png`
- 聚焦对比：`/Users/yuruby/.codex/visualizations/2026/08/26/xiaowu-qa/comparison-success-focus-final.png`

## 检查结果

- 角色：斗篷身体、晶体触角、蓝紫发光和左侧悬挂位置与融合稿一致；五种状态使用同一画布和锚点，无身份漂移。
- 布局：待机只露触角和半张脸；展开卡片保持在手机视口内。正式阅读反馈位于正文选择上方，不遮挡返回、声音和剧情操作。
- 200% 缩放：对话卡改用受限高度并从 Dock 上方定位，无横向滚动、顶部裁切或操作按钮丢失。
- 动效：`prefers-reduced-motion: reduce` 下关闭角色循环、滑入、收起和光标动画；播放时长直接降为零，不保留逐字等待。
- 可访问性：角色与 Dock 共用受控开启状态和 `aria-expanded`；关闭后恢复到实际触发入口；正式阅读隐藏 Dock 但保留具名小雾按钮。
- 内容与功能：任务、推荐、注册邀请、进度接续、语音、ducking、跳过、超时和失败恢复均保留；历史 `terminal*` 字段和默认名称兼容。
- 质量：透明 WebP 边缘清晰，无临时 CSS 人物或占位 SVG；控制台未发现由小雾组件引入的新增错误。

## 迭代记录

1. 修复正式阅读角色负向顶部裁切，将阅读态锚定到顶部安全区域。
2. 收紧待机裁切，只显示触角和半张脸。
3. 压缩正式阅读反馈卡并右移，避免覆盖正文选择。
4. 提高标准页面角色与 Dock 的间距；增加低高度／200% 缩放规则。
5. 双轨审查后补齐系统 reduced motion 自动识别、媒体阶段持久收起、实际触发入口焦点恢复，并删除旧全屏终端样式。
6. Staging 实机复验发现 200% 等效矮视口下对话卡顶部越界 39px；将低高度定位改为距锚点 8px、最大高度改为 `100svh - 112px`，补充 CSS 回归契约后不再裁切。

## 发布前验证

- `pnpm typecheck`、`pnpm lint`、构建和全量测试通过，共 194 项测试。
- 390×844 无横向滚动；Dock 显示“小雾”，角色入口与 Dock 的 `aria-expanded` 同步。
- `prefers-reduced-motion: reduce` 实测 `animation-name: none`、动画与过渡时长均为 `0s`。
- 部署前后三部 Staging 测试小说的 ID、章节数量及公开 API 响应哈希保持一致。

## 最终结果

passed

---

# 雾庭 P3 Design QA

- 范围：等级动作、服装购买与装备、庭院购买与装备、全站侧边形象同步和资产失败回退
- 验收日期：2026-08-29
- 证据：
  - 390×844：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p3/garden-p3-390x844.png`
  - reduced motion：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p3/garden-p3-reduced-motion-390x844.png`
  - 两套服装五态合览：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p3/collections-contact.png`
  - 两套服装互动与动作姿势合览：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p3/poses-contact.png`

## 视觉资产

- ImageGen 以已确认的小雾透明母版执行图片编辑：星辉斗篷保留星空材质，档案斗篷替换为深海军蓝档案纹、青色发光缝线、纸页饰片和银色文档扣；每套均生成 `idle / greeting / notice / success / warning` 五个侧边反馈状态，以及 `touch / play / rest / antenna-response / spin-hover / hug-memory` 六个雾庭专用姿势。
- ImageGen 以新图生成模式制作两张无角色庭院：萤光树根采用青紫发光的世界树根系与中央平台，星苗圃采用水晶花盆、发光星苗和中央互动平台。
- 最终资产位于 `public/xiaowu/appearances/{starlight-cloak,archive-cloak}/` 与 `public/xiaowu/gardens/`。二十二张角色 WebP 均经 `hasAlpha: yes` 验证；服装状态与姿势统一为 640×640，庭院为 768×1365。

## 结果

- 360×800、390×844、430×932 均满足 `scrollWidth === innerWidth`；雾庭隐藏侧边探头、固定 Dock 保持可见，三个互动按钮无裁切。200% 等效内容视口保持单列布局且没有额外横向滚动。
- `prefers-reduced-motion: reduce` 实测匹配，庭院场景、角色和 Dock 的 `animation-name` 均为 `none`，动画与过渡时长为 `0s`。
- 读屏快照提供“世界树庭院”“小雾成长状态”“陪小雾待一会”“收藏”“记忆册”等区域名称；服装、庭院与互动按钮均有完整可读名称。
- 登录合同覆盖“购买后拥有、再次点击装备、播放已解锁动作、侧边小雾读取账号装备”；未达等级动作由领域模块拒绝。角色资源失败回退同神情默认形象，庭院资源失败隐藏图片并恢复默认 CSS 世界树。
- 真实 D1 测试覆盖不同 operation id 的并发重复购买只扣款一次、同 operation id 的不同请求指纹稳定冲突、装备重放、陌生账号无所有权拒绝、导出包含 inventory、成长重置与并发动作补齐不会复活 inventory。
- 最终门禁通过：`pnpm typecheck`、`pnpm lint`、生产构建、160 项模块／HTTP 测试与 59 项 React 测试；浏览器控制台无新增 warning 或 error。

## 最终结果

passed

---

# 雾庭 P2 Design QA

- 范围：有效阅读奖励、路线探索度、最近奖励与记忆册
- 证据：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p2/garden-p2-390x844.png`
- 视口：360×800、390×844、430×932 与 200% 等效窄视口

## 结果

- 所有视口满足 `scrollWidth === innerWidth`，新增记忆册与路线探索卡无横向溢出，固定 Dock 不遮挡内容。
- 雾庭仍不重复挂载侧边小雾；访客只看到会话试玩说明与记忆册保存边界。
- `prefers-reduced-motion: reduce` 实测匹配，庭院角色 `animation-name: none`，动画和过渡时长均为 `0s`。
- 记忆卡自动化验收覆盖封面、作品名、章节名与完成时间；不包含正文或选择文字。
- 双轨初审指出的节点事实丢失、跨章节心跳重叠、重置水位穿透与失败请求丢弃已修复；真实 D1 竞态测试确认跨章节并发只计一次，旧奖励和旧记忆不会在重置后恢复。
- 最终门禁通过：`pnpm typecheck`、`pnpm lint`、生产构建、157 项模块／HTTP 测试与 58 项 React 测试。

## 最终结果

passed

---

# 雾庭 P1 Design QA

- 范围：Dock 与侧边小雾职责分离、`/xiaowu` 世界树庭院、账号成长与会话试玩
- 基准视口：390×844；补充检查 360×800、430×932、200% 缩放和 reduced motion
- 验收日期：2026-08-28

## 证据

- 390×844：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p1/garden-390x844.png`
- 360×800：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p1/garden-360x800.png`
- 430×932：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p1/garden-430x932.png`
- 200% 缩放修复后：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p1/garden-200pct-fixed.png`
- reduced motion：`/Users/yuruby/.codex/visualizations/2026/08/16/01a00a04-64ab-7a60-8f2b-913d1eb879a9/xiaowu-garden-p1/garden-reduced-motion-390x844.png`

## 结果

- 360、390、430 与 200% 缩放均满足 `scrollWidth === innerWidth`，没有横向滚动。
- 200% 缩放初检发现三列系统头部会挤掉当前档案；修复为保留品牌与“雾庭”状态、隐藏次要连接状态，复验通过。
- 雾庭不挂载侧边小雾；Dock“小雾”是活动链接，侧边轻量气泡仍提供“前往雾庭”。正式阅读继续不显示 Dock。
- 访客明确显示“本次会话试玩”和“不保存”，页面没有注册按钮；“一起玩”可见地将雾光从 20 更新为 17，并反馈活力恢复。
- reduced motion 实测匹配成功，庭院角色 `animation-name: none`、`animation-duration: 0s`。
- 交互控件均有可读名称；自动化合约覆盖 Dock 链接、按钮操作、对话焦点恢复和雾庭不重复角色。
- 控制台无新增 warning 或 error。
- 双轨初审发现的奖励并发、重置基线、模块边界、缓存与 HTTP 越权缺口已修复；阅读完成现在只写入按发布版本保留的事实，成长奖励统一由 `CompanionLifecycle` 幂等补偿。
- 复审发现的 revision ABA 与客户端未来时间漏洞已修复：重置使用单调 CAS，奖励基线只比较服务端事实记录时间；真实 D1 陈旧提交回归验证稳定返回 conflict。
- 最终门禁通过：`pnpm typecheck`、`pnpm lint`、生产构建、150 项模块／HTTP 测试与 58 项 React 测试全部成功。

## 最终结果

passed
