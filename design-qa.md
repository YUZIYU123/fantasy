# 小雾精灵化终端 Design QA

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
