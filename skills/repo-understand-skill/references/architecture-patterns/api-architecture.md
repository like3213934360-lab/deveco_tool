# ArkTS 路由与通信架构模式

## HarmonyOS 路由体系

**Router 路由**（简单场景）：

```arkts
import router from '@ohos.router'

router.pushUrl({ url: 'pages/DetailPage' })      // 压栈跳转
router.replaceUrl({ url: 'pages/LoginPage' })     // 替换当前页
router.back()                                      // 返回上一页
router.clear()                                     // 清空路由栈
```

**Navigation 组件路由**（推荐）：

```arkts
// NavPathStack 驱动，支持跨模块动态注册
@Entry
@Component
struct MainPage {
  navPathStack: NavPathStack = new NavPathStack()

  build() {
    Navigation(this.navPathStack) {
      Button('跳转详情').onClick(() => {
        this.navPathStack.pushPathByName('DetailPage', { id: 42 })
      })
    }
  }
}
this.navPathStack.pop()              // 返回上一页
this.navPathStack.replacePathByName('HomePage', null) // 替换当前页
```

**Want 路由**（跨 Ability）：

```arkts
import common from '@ohos.app.ability.common'

let want: Want = {
  bundleName: 'com.example.app',
  abilityName: 'SecondAbility',
  parameters: { userId: '1001' }
}
this.context.startAbility(want)
```

**三种路由选择策略**：

| 路由类型 | 适用场景 | 路由栈管理 | 跨Ability | 推荐度 |
|---------|---------|-----------|----------|-------|
| Router | 简单页面跳转 | 系统管理 | 不支持 | 旧项目兼容 |
| Navigation | 应用内导航 | NavPathStack自管理 | 不支持 | 推荐 |
| Want | 跨Ability/跨应用 | 系统管理 | 支持 | 跨模块必须 |



---

## 跨模块通信机制

**CommonEvent 事件广播**（发布/订阅模式）：

```arkts
import CommonEvent from '@ohos.commonEvent'

// 发布事件
CommonEvent.publish('com.example.USER_LOGIN_EVENT', { data: 'userId=1001' })

// 订阅事件
let subscriber = CommonEvent.createSubscriber({ events: ['com.example.USER_LOGIN_EVENT'] })
CommonEvent.subscribe(subscriber, (err, data) => {
  if (!err) { console.info('收到事件: ' + data.data) }
})
CommonEvent.unsubscribe(subscriber)  // 取消订阅
```

**Action 常量定义与使用**：

```arkts
export class ActionConstants {
  static readonly USER_LOGIN: string = 'com.example.USER_LOGIN_EVENT'
  static readonly DATA_REFRESH: string = 'com.example.DATA_REFRESH_EVENT'
  static readonly SETTINGS_CHANGE: string = 'com.example.SETTINGS_CHANGE'
}
// Want 路由中使用
let want: Want = { action: ActionConstants.USER_LOGIN, parameters: { userId: '1001' } }
```

**ServiceExtensionAbility 服务调用**：

```arkts
// 定义服务 Extension
export default class CalcService extends ServiceExtensionAbility {
  onConnect(want: Want) { return new CalcRemoteObject() }
  onDisconnect(want: Want) { /* 释放连接 */ }
}
// 客户端通过 startAbilityByType 或 connectServiceExtensionAbility 调用
this.context.connectServiceExtensionAbility(want, options)
```

**DataShareExtensionAbility 数据共享**：

```arkts
export default class DataShareExt extends DataShareExtensionAbility {
  onCreate() { return dataShareHelper }
  onInsert(uri: string, value: ValuesBucket) { /* 插入数据 */ }
  onQuery(uri: string, predicates: DataSharePredicates) { /* 查询数据 */ }
}
// 其他 Ability 通过 DataShareHelper 访问
let helper = dataShare.createDataShareHelper(this.context, 'datashare:///com.example/data')
```

**BroadCast 组件内广播**（区别于 CommonEvent）：

```arkts
// 组件内局部广播，不跨 Ability
@Component
struct ParentComponent {
  broadCast: BroadCast = new BroadCast()
  aboutToAppear() {
    this.broadCast.on('childEvent', (data: string) => { /* 处理子组件事件 */ })
  }
  build() {
    ChildComponent({ broadCast: this.broadCast })
  }
}
@Component
struct ChildComponent {
  broadCast?: BroadCast
  build() {
    Button('触发').onClick(() => { this.broadCast?.emit('childEvent', 'payload') })
  }
}
```

---

## 请求处理分层

**View 层**：用户交互入口，组件 build() 方法中的回调绑定。

```arkts
@Component
struct UserListView {
  @State userList: User[] = []
  controller: UserController = new UserController()

  build() {
    List() {
      ForEach(this.userList, (user: User) => {
        ListItem() {
          Text(user.name).onClick(() => {
            this.controller.onItemClick(user.id)  // 回调绑定
          })
        }
      })
    }.onAppear(() => { this.controller.loadUsers() }) // 生命周期回调
  }
}
```

**Controller 层**：业务逻辑协调、回调分发（emitCallback/onCallback）。

```arkts
export class UserController {
  private viewModel: UserViewModel = new UserViewModel()

  onItemClick(userId: number): void {
    this.viewModel.selectUser(userId)
    this.emitCallback('navigateToDetail', { id: userId }) // 回调分发
  }
  loadUsers(): void { this.viewModel.fetchUserList() }
}
```

**ViewModel 层**：数据获取与状态管理（@Observed VM 类）。

```arkts
@Observed
export class UserViewModel {
  @Track userList: User[] = []
  @Track selectedId: number = -1

  async fetchUserList(): void {
    let result = await UserService.queryUsers()
    this.userList = result.data
  }
  selectUser(id: number): void { this.selectedId = id }
}
```

---

## 错误处理与响应

**BusinessError 标准错误处理模式**：

```arkts
import BusinessError from '@ohos.base'

try {
  this.navPathStack.pushPathByName('DetailPage', { id: 42 })
} catch (err) {
  let e = err as BusinessError
  console.error(`路由失败 code=${e.code} message=${e.message}`)
  // 回退策略：跳转错误页或返回首页
  this.navPathStack.replacePathByName('ErrorPage', { errorCode: e.code })
}
```

**try-catch 模式（@ohos.base.BusinessError）**：

```arkts
import { BusinessError } from '@ohos.base'

async function safeCall(): void {
  try {
    let result = await UserService.queryUsers()
    this.userList = result.data
  } catch (err) {
    let e = err as BusinessError
    if (e.code === 16000050) {  // 路由参数错误
      this.handleError('参数校验失败')
    } else {
      this.handleError(e.message)
    }
  }
}
```

**回调函数错误传递（onError/onFail 参数）**：

```arkts
CommonEvent.publish(ActionConstants.USER_LOGIN, {
  data: JSON.stringify({ userId: '1001' })
}, (err: BusinessError) => {
  if (err) { this.onError(`事件发布失败: ${err.message}`) }
})

// Controller 中统一错误回调
this.controller.onCallback('loadFail', (errorCode: number, msg: string) => {
  this.showToast(msg)
})
```

---

## 路由与通信理解检查清单

- [ ] 识别路由类型（Router / Navigation / Want）
- [ ] 定位路由注册文件（main_pages.json / NavPathStack映射）
- [ ] 找到 NavigationConstants 路由常量定义
- [ ] 分析路由参数类型安全（interface 定义）
- [ ] 追踪 CommonEvent 发布/订阅链
- [ ] 识别 Action 常量与 Want 路由定义
- [ ] 检查 ServiceExtensionAbility / DataShareExtensionAbility 调用
- [ ] 区分 BroadCast（组件内）与 CommonEvent（跨Ability）
- [ ] 定位 Controller 层回调分发逻辑
- [ ] 分析 BusinessError 错误处理与回退策略