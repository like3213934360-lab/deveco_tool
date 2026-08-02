# Skill 路由索引

本包共 57 个 Skill，分两层：

- **core（18 个）** —— 从 DevEco Code 提取的核心能力。安装器的 `--profile core` 只装这一层。
- **extended（39 个）** —— 来自华为官方 HarmonyOS Agent Skills 仓库（`v0.0.2`）的场景化能力，按需加载。

**先读本索引再选 Skill，不要把 57 份 frontmatter 全部读进上下文。** 每个 Skill 的完整描述在它自己的
`SKILL.md` frontmatter 里；本索引只给「什么时候用它」。机器可读的完整清单见
[`../manifest.json`](../manifest.json) 的 `skills[]`，其中每条都有 `tier`、`category`、`origin`。

两层的来源和许可状态不同，取用前请看 [`../provenance/SOURCES.md`](../provenance/SOURCES.md)。

## core 层（18 个）

### 工具与流程

- **deveco-create-project** — Creating, initializing, or scaffolding a new ArkTS project.
- **harmony-build-loop** — Any session that edits, builds, or runs an ArkTS project.
- **harmony-sdd-workflow** — Running the five-phase SDD workflow end to end instead of invoking the commands one at a time.
- **deveco-cli** — Listing connected devices or managing emulators.

### 开发

- **arkts-grammar-standards** — Before writing or modifying the first .ets file of a session.
- **arkts-error-fixes** — Compilation fails or an ArkTS type error needs fixing.
- **arkui-component-best-practices** — Writing, reviewing, or debugging ArkUI component code.
- **arkts-logic-completer** — Filling functional logic into a generated or skeletal ArkUI page.
- **repo-understand-skill** — Locating functionality or understanding architecture in an unfamiliar ArkTS project.
- **arkui2hds** — Replacing ArkUI components with HDS equivalents.

### 设计与还原

- **harmony-plan-doc** — Writing an implementation plan or technical design for a HarmonyOS change.
- **solution-design** — Producing a module design document or software architecture for a feature.
- **responsive-layout-generator** — Turning fixed-position layout data into an adaptive ArkUI layout.
- **d2c-fast** — Converting a Pixso design (link, selected node, or developer-supplied DSL plus local assets) int
- **ui-reconstruction-score** — Judging how closely an implemented ArkUI page matches its design reference.
- **arkui-scoring-workflow** — An ArkUI page is implemented and needs to be compared against its design reference on a real tar

### 问题诊断与场景方案

- **arkts-runtime-fix** — The app crashes, flashes back, or white-screens; a jscrash log or stack trace is available.
- **harmony-debug-instrumentation** — The app builds and runs but behaves wrong and the bug reproduces on device.

## extended 层（39 个）

### 工具与流程

- **deveco-studio-codelinter** — 对 HarmonyOS（鸿蒙）项目运行 DevEco Studio CodeLinter 静态代码检查，解读检查结果并提供修复建议。支持 ArkTS、TS、JS 文件，涵盖性能、安全、代码规范
- **deveco-studio-emulator** — HarmonyOS模拟器管理助手。**首次使用必须先运行 `node scripts/setup.js --force` 配置路径**，然后才能执行模拟器启动、应用安装调试等操作。包含完整的场
- **deveco-studio-verify** — HarmonyOS 设备验证工具 - 支持多设备类型验证（手机/折叠屏/平板）、应用安装、UI自动化操作、截图验证、日志收集和 Journey 测试框架。使用 hdc 命令行工具直接操作设备。

### 开发

- **hmos-ability-insight-intent-generator** — |
- **hmos-arkts-deprecated-interface-checker** — 检查 HarmonyOS 项目中的废弃 SDK 接口并提供修复建议。当需要清理废弃 API、升级 API 版本、优化代码质量或进行静态语法检查时使用。提供详细的迁移方案、修复优先级分类和代码示
- **hmos-arkts-knowledge-retriever** — Retrieve grounded ArkTS references for pure non-UI ArkTS work and ArkTS API usage. Use this skil
- **hmos-arkui-develop-skill** — |
- **hmos-arkui-knowledge-retriever** — (1) 用户查询 ArkUI/ArkTS API 用法、参数细节或版本支持 (2) 验证组件/装饰器的正确用法 (3) 排查 ArkUI 编译错误码或运行时异常 (4) 询问状态管理 V1/V
- **hmos-arkui-longtake-transition** — 为鸿蒙(HarmonyOS)应用添加一镜到底转场效果。当用户提到一镜到底、转场动画、页面跳转动画、Navigation转场、卡片展开动画、图片查看大图动画、ezcustomtransition
- **hmos-arkui-mvvm-pattern** — HarmonyOS ArkUI MVVM 架构技能。适用于：(1) 项目分层设计 Model/ViewModel/View (2) 目录结构规划 (3) 组件职责与数据流规范 (4) 视图架构
- **hmos-arkui-scenario-development** — HarmonyOS/鸿蒙 ArkUI 场景化开发技能，用于实现、排查或验证 ArkUI(.ets) 功能，并按需求(REQ)/开发(DEV)/修复(FIX)/验证(VAL)四阶段路由到4个一级
- **hmos-arkui-statemgt-migration** — (1) V1项目升级到V2；(2) 迁移@Component/@State/@Prop/@Link/@Observed/@ObjectLink/@Provide/@Consume/@Watch
- **hmos-ascf-assistant** — (1) 任何提到 ASCF 的问题；(2) 检测到项目包含 ascf/ascf_src 目录（即 ASCF 项目）；(3) 需要生成元服务睫毛图；(4) 将小程序转换为 ASCF 元服务；(5
- **hmos-ascf-convert-taro** — 辅助开发者将 Taro 项目适配（转换）为 ASCF 元服务。当需要在 Taro（React/Vue）项目中支持 ASCF 元服务平台，或将现有 Taro 项目迁移到 ASCF 时使用此技能。
- **hmos-ascf-convert-uniapp** — 辅助开发者将 uni-app 项目适配(转换)为 ASCF 元服务。当需要使用 uni-app（HBuilderX 或 CLI）开发 HarmonyOS 元服务（MP-HARMONY），或将现
- **hmos-atomicservice-assistant** — 辅助鸿蒙开发者构建元服务（Atomic Service / 免安装应用）。只要用户提到元服务、atomicService、免安装、atomic service，或遇到以下任意问题，都必须使用本
- **hmos-scan-kit-customscan** — 帮助开发者快速接入华为 Scan Kit 自定义界面扫码能力，仅在需要支持完全自定义相机预览流 UI 界面、闪光灯控制、变焦、对焦等功能的场景使用
- **hmos-scan-kit-defaultscan** — 帮助开发者快速接入华为 Scan Kit 默认界面扫码能力，在不需要完全自定义相机界面、闪光灯控制、变焦、对焦等高级功能时优先使用
- **hmos-account-kit-quicklogin-client** — 基于 HarmonyOS Account Kit 提供华为账号一键登录客户端接入指引，实现获取匿名手机号接口与华为账号一键登录组件集成。支持获取匿名手机号后一键登录页面跳转、失败Toast提示
- **hmos-live-view-kit-build-location** — HarmonyOS实况窗（LiveView）代码生成助手，支持创建、更新、停止实况窗。用户输入创建/更新/结束/完整/补全实况窗代码时触发，覆盖即时配送、打车、排队、计时、航班、高铁、共享租赁
- **hmos-push-kit** — |
- **hmos-push-kit-token** — |
- **hmos-push-kit-notification** — |
- **hmos-push-kit-voip** — |
- **hmos-push-kit-background** — |

### 设计与还原

- **hmos-design-visual-mobile** — (1) 用户要求生成/还原 HarmonyOS 移动端页面 (2) 用户提供设计稿/截图/参考图，要求还原为 HarmonyOS 风格 HTML 页面 (3) 用户提到"视觉还原"/"高保真页

### 问题诊断与场景方案

- **hmos-multidevice-avoid-areas** — the task involves safe area expansion, status bar or navigation bar avoidance, notch or cutout h
- **hmos-multidevice-fold-state** — the task involves fold status detection, hover-mode split-screen layouts, c...
- **hmos-multidevice-hardware-access** — the task involves camera selection, camera rotation/stride/foldable adaptation, canIUse or S...
- **hmos-multidevice-interaction-methods** — HarmonyOS应用多设备交互适配开发方案skill，提供触摸、鼠标、键盘、手写笔等多输入方式的交互方案和事件归一策略。当涉及触摸、鼠标、键盘、手写笔等设备的交互以及实现交互归一化、悬停效果
- **hmos-multidevice-natural-orientation** — 鸿蒙 HarmonyOS 屏幕方向与旋转相关的需求分析、开发实现、问题修复和功能验证。当任务涉及以下场景时使用：setPreferredOrientation、屏幕旋转(rotation)、屏
- **hmos-multidevice-screen-window-size** — HarmonyOS 多设备屏幕窗口尺寸适配。当任务涉及以下任一场景时必须调用：（1）比价与分屏：比价/比价场景/比价窗口/价格对比/创建新窗口/多窗口并行/双窗口；（2）平行视界与分栏：平行视
- **hmos-apifault-analysis** — 定位开发者问题。当遇到 API 调用失败或报错、错误码（如 5400xxx、801、9200 等）、crash/freeze 日志（hilog、HiviewDFX）、或需要根据日志与源码定位问
- **hmos-appfreeze-analysis** — >
- **hmos-jscrash-analysis** — >
- **hmos-memleak-analysis** — (1) Performing static code analysis to catch potential leaks before deployment, (2) Reviewing PR

### 测试

- **hmos-instrument-test** — 在 HarmonyOS 应用/服务开发中执行模块的 Instrument Test（包括 ArkTS/JS 和 C++ 测试），支持运行、覆盖率统计、ASan 检测等模式，并可指定测试范围（模
- **hmos-local-test** — 在 HarmonyOS 应用/服务开发中执行模块的 Local Test（ArkTS/JS 单元测试），支持运行、覆盖率统计等模式，并可指定测试范围（模块、测试套件、单个用例）。

### 上架

- **app-metadata-audit-skill** — 开发者在app开发提交agc前，可利用该skill规范对应用市场的元数据（名称、描述、关键词、隐私链接等）进行自动化合规性审查。支持华为应用市场审核规范，防止因低级错误导致被拒。
