# UI架构模式参考文档

## 常见UI架构模式

### MVVM (Model-View-ViewModel)

**适用框架**：ArkUI, Vue, Angular, React (with state management)

**核心概念**：
- **View（视图）**：UI组件，负责展示和用户交互
- **ViewModel（视图模型）**：管理UI状态和业务逻辑，与View双向绑定
- **Model（模型）**：数据模型，负责数据存储和业务规则

**ArkUI中的MVVM实现**：

```typescript
// Model - 数据模型
export class UserModel {
  id: string = ''
  name: string = ''
  avatar: string = ''
}

// ViewModel - 视图模型
@Observed
export class UserViewModel {
  @Trace users: UserModel[] = []
  @Trace isLoading: boolean = false

  async loadUsers() {
    this.isLoading = true
    this.users = await UserService.getUsers()
    this.isLoading = false
  }
}

// View - 视图
@Component
export struct UserListPage {
  @ObjectLink viewModel: UserViewModel

  build() {
    Column() {
      if (this.viewModel.isLoading) {
        LoadingIndicator()
      } else {
        List({ space: 8 }) {
          ForEach(this.viewModel.users, (user: UserModel) => {
            UserItem({ user: user })
          })
        }
      }
    }
  }
}
```

**识别特征**：
- 使用 `@Observed` 和 `@ObjectLink` 装饰器
- 使用 `@Trace` 装饰器标记响应式属性
- ViewModel类负责数据获取和状态管理
- View只负责展示，不直接处理业务逻辑

---

### MVC (Model-View-Controller)

**适用场景**：简单页面，Controller处理用户操作并更新Model

**ArkUI中的体现**：Controller类作为中间层协调View与Model，单向数据流。大型ArkTS应用通常演化为MVVM而非纯MVC。

**识别特征**：
- Controller类处理用户交互逻辑
- View只负责渲染
- 单向数据流：Controller → Model → View

---

### 组件化架构

**适用框架**：React, Vue, ArkUI

**核心概念**：
- UI拆分为独立可复用的组件
- 组件通过props传递数据
- 组件通过events通信

**ArkUI组件化示例**：

```typescript
// 父组件
@Component
export struct ParentComponent {
  @State count: number = 0

  build() {
    Column() {
      ChildComponent({
        value: this.count,
        onChange: (newValue: number) => {
          this.count = newValue
        }
      })
    }
  }
}

// 子组件
@Component
export struct ChildComponent {
  @Prop value: number
  onChange?: (value: number) => void

  build() {
    Button(`Count: ${this.value}`)
      .onClick(() => {
        this.onChange?.(this.value + 1)
      })
  }
}
```

**识别特征**：
- 使用 `@Component` 装饰器
- 使用 `@Prop` 装饰器接收父组件数据
- 使用 `@State` 装饰器管理本地状态
- 使用回调函数进行子到父通信

---

## ArkUI特有的状态管理模式

### @State - 组件本地状态

```typescript
@Component
export struct MyComponent {
  @State count: number = 0  // 本地状态

  build() {
    Button(`Count: ${this.count}`)
      .onClick(() => {
        this.count++  // 状态变更触发UI更新
      })
  }
}
```

### @Prop - 父子组件单向传递

```typescript
// 子组件
@Component
export struct ChildComponent {
  @Prop title: string  // 从父组件接收，不可修改
}
```

### @Link - 父子组件双向绑定

```typescript
// 父组件
@Component
export struct ParentComponent {
  @State isActive: boolean = false

  build() {
    ChildComponent({ isActive: $isActive })  // 使用$传递引用
  }
}

// 子组件
@Component
export struct ChildComponent {
  @Link isActive: boolean  // 可修改，会同步到父组件
}
```

### @Provide/@Consume - 跨组件传递

```typescript
// 祖先组件
@Component
export struct AncestorComponent {
  @Provide theme: string = 'dark'
}

// 后代组件
@Component
export struct DescendantComponent {
  @Consume theme: string  // 自动从祖先获取
}
```

### @ObjectLink/@Observed - 对象属性监听

```typescript
@Observed
export class UserModel {
  @Trace name: string = ''
}

@Component
export struct UserComponent {
  @ObjectLink user: UserModel  // 监听对象内部属性变化
}
```

---

## UI组件层次结构识别

### 页面级组件 (Page)

**特征**：
- 使用 `@Entry` 装饰器
- 注册在 `main_pages.json` 中
- 通常作为路由目标

```typescript
@Entry
@Component
export struct HomePage {
  build() {
    // 页面内容
  }
}
```

### 容器组件 (Container)

**常见容器**：
- Column - 垂直布局
- Row - 水平布局
- Stack - 层叠布局
- Grid - 网格布局
- List - 列表
- Scroll - 滚动容器

### 基础组件 (Basic Component)

**常见基础组件**：
- Text - 文本
- Button - 按钮
- Image - 图片
- TextInput - 输入框
- Checkbox - 复选框
- Radio - 单选框

### 自定义组件 (Custom Component)

**特征**：
- 使用 `@Component` 装饰器
- 可复用
- 通过 `build()` 方法定义UI

---

## 布局模式识别

### Flex布局

```typescript
Column() {
  // 子组件
}
.width('100%')
.height('100%')
.justifyContent(FlexAlign.Center)
.alignItems(HorizontalAlign.Center)
```

### Grid布局

```typescript
Grid() {
  GridItem() {}
  GridItem() {}
}
.columnsTemplate('1fr 1fr')
.rowsTemplate('1fr 1fr')
```

### Stack布局

```typescript
Stack() {
  Text('Bottom')
  Text('Top')
}
.alignContent(Alignment.Center)
```

---

## 响应式布局识别

### 断点适配

```typescript
@Component
export struct ResponsiveComponent {
  @StorageLink('currentBreakpoint') currentBreakpoint: string = 'sm'

  build() {
    if (this.currentBreakpoint === 'sm') {
      // 手机布局
    } else if (this.currentBreakpoint === 'md') {
      // 平板布局
    } else {
      // PC布局
    }
  }
}
```

### 百分比布局

```typescript
Column() {
  Row().width('50%')  // 占父容器50%宽度
  Row().layoutWeight(1)  // 占剩余空间
}
```

---

## 样式管理识别

### 内联样式

```typescript
Text('Hello')
  .fontSize(16)
  .fontColor('#333333')
  .margin({ top: 8, bottom: 8 })
```

### 样式复用

```typescript
// 使用@Styles装饰器
@Styles
function cardStyle() {
  .backgroundColor('#FFFFFF')
  .borderRadius(8)
  .padding(16)
  .shadow({ radius: 8 })
}

// 使用
Column() {}
.cardStyle()
```

### 主题变量

```typescript
Text('Hello')
  .fontColor($r('app.color.text_primary'))
  .fontSize($r('app.font.size_medium'))
```

---

## UI架构理解检查清单

- [ ] 识别架构模式（MVVM/MVC/组件化）
- [ ] 梳理组件层次结构
- [ ] 识别状态管理方式
- [ ] 分析组件通信方式
- [ ] 提取布局模式
- [ ] 识别响应式布局策略
- [ ] 分析样式管理方式
- [ ] 定位可复用组件