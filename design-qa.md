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

## 最终结果

passed
