## 9. 导航与路由约束

| 规则 | 说明 |
|------|------|
| Router 不推荐 | **推荐使用 Navigation** 替代 Router。Navigation 支持更丰富的动画、生命周期、路由拦截、沉浸式等 |
| Router 页面栈上限 32 | 超过 32 页产生错误码 **100003** |
| Navigation 默认转场时长不可控 | 使用弹簧曲线，时长因设备而异。**不要将业务逻辑耦合到默认转场时长** |
| 共享元素转场需禁用默认转场 | 使用 geometryTransition 时**必须禁用**系统默认转场动画，否则两者叠加产生视觉异常 |
| customNavContentTransition 优先级更高 | 同时设置 Navigation 级和 NavDestination 级转场时，Navigation 级（customNavContentTransition）**优先** |
| Dialog 类型 NavDestination 无默认转场 | API 13 前，Dialog 类型 NavDestination **没有默认转场动画** |
| 未注册 builder 函数 | Navigation 跳转未注册 builder 的页面会报错码 **100005** |
| 无 NavDestination 组件 | Navigation 跳转未包含 NavDestination 的页面会报错码 **100006** |
| 无效 UIContext | 路由跳转需要有效的 UIContext，无效时可能导致异常 |
| pushPath/pushDestination 的 param 禁内联字面量 | `pushPath({ name, param: { id: 1 } })` 内层 param 是无类型字面量 → **10605038**（arkts-no-untyped-obj-literals）；必须先 `interface P { id: number }` 再用 `const p: P = { id: 1 }` 传递，取参 `ctx.pathInfo.param as P` |
| NavDestination 无 titleMode | titleMode 是 **Navigation 专属**属性（返回 NavigationAttribute），NavDestination 只有 `.title()`。在 NavDestination 链上调用 `.titleMode()` 报 **10505001**（Property 'titleMode' does not exist on type 'NavDestinationAttribute'）。titleMode 只能挂在 Navigation 上 |

## 常见错误

- **使用 `@ohos.router` 做页面跳转**：推荐使用 Navigation + NavDestination 替代 Router
- **多个页面各自 `@Entry`**：单 Page 应用应该只有一个 @Entry，多页面应通过 Navigation 管理
- **Navigation 跳转未注册 builder**：会报错码 100005，必须在 Navigation 中注册 destination builder
- **使用 `pageTransition` 做页面转场**：pageTransition 已废弃，应使用 Navigation 转场
- **pushPath 的 param 内联字面量**：`param: { id: 1 }` 报 10605038；必须先声明 interface 再用 interface 类型变量传递
- **NavDestination 调用 titleMode**：报 10505001；NavDestination 只用 `.title()`，`.titleMode()` 只挂 Navigation
- **根因**：AI 倾向使用更"直观"的 router API，不清楚 Navigation 是推荐方案

---

### 多文件 Navigation 路由架构

**不要把所有页面放在一个文件**。`@ComponentV2 export struct` 支持跨文件导出。两种方案：

**方案一：自定义路由表（静态 import）**——简单项目推荐
```
页面文件：@ComponentV2 export struct XxxPage { @Param navPathStack ... }
主文件：  import { XxxPage } from './XxxPage'
         @Builder pageMap(name, param) { if (name === 'Xxx') XxxPage({...}) }
         Navigation(stack).navDestination(this.pageMap)
```
- 用 `@Param` 传递 navPathStack 给子页面（V2 方式）
- 用 `@Param` 传递页面参数
- `@Builder pageMap` 中用 `if/else if` 做路由映射是合法的

**方案二：系统路由表（router_map.json）**——跨模块/跨包推荐
- 每个模块配置 `resources/base/profile/router_map.json`
- `module.json5` 添加 `"routerMap": "$profile:router_map"`
- 页面文件导出 `@Builder export function XxxBuilder(): void { XxxPage() }`
- 主文件用 `pushPathByName('PageName', param)` 跳转，无需 import 页面文件
- 通过 `NavDestination.onReady` 回调获取 pathStack

---

### 单文件 Navigation 最小模板

**单文件演示 Navigation 时**，必须包含 navDestination builder 注册，否则跳转报 100005/100006。注意 titleMode 只挂 Navigation，不挂 NavDestination。

```typescript
interface PageParam { seq: number }

@Entry
@Component
struct NavDemo {
  @State stack: NavPathStack = new NavPathStack()
  private seq: number = 0

  private pushPage(name: string): void {
    this.seq += 1
    const p: PageParam = { seq: this.seq }   // param 必须先声明 interface，禁内联字面量
    this.stack.pushPath({ name: name, param: p })
  }

  @Builder
  pageMap(name: string, param?: Object) {
    if (name === 'first' || name === 'second') {
      NavDestination() {
        Column({ space: 12 }) {
          Text(`Page: ${name}  #${param ? (param as PageParam).seq : 0}`)
          Text(`Stack size: ${this.stack.size()}`)   // NavPathStack.size() 取栈大小
          Button('pop').onClick(() => { this.stack.pop() })
        }
      }
      .title(`Page ${name}`)          // ✅ NavDestination 只有 .title()
      // .titleMode(NavigationTitleMode.Mini)  ❌ NavDestination 无 titleMode，报 10505001
    }
  }

  build() {
    Navigation(this.stack) {
      Column({ space: 12 }) {
        Text(`Stack size: ${this.stack.size()}`)
        Button('push first').onClick(() => this.pushPage('first'))
        Button('replace second').onClick(() => this.stack.replacePath({ name: 'second' }))
        Button('popToName first').onClick(() => this.stack.popToName('first'))
      }
    }
    .navDestination(this.pageMap)
    .title('Navigation Demo')
    .titleMode(NavigationTitleMode.Mini)   // ✅ titleMode 挂在 Navigation 上
  }
}
```
