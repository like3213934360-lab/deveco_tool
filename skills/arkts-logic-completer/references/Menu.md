# Menu 菜单功能逻辑规格

## 1. 功能定位

Menu 是菜单组件，以垂直列表形式显示操作选项，需配合 bindMenu 或 bindContextMenu 使用。当需要为组件提供点击或长按弹出的上下文操作集合时使用。

## 2. 典型场景

- 页面右上角"更多"按钮弹出操作菜单（分享、收藏、举报）
- 列表项长按弹出上下文菜单（编辑、复制、删除）
- 文本编辑区右键菜单（剪切、复制、粘贴、全选）
- 导航栏分类筛选菜单（排序方式、显示模式切换）

## 3. 状态声明

```typescript
@State isMenuVisible: boolean = false
@State selectedAction: string = ''  // 'copy' | 'paste' | 'delete' | ...
@State sortMode: string = 'default'  // 'default' | 'name' | 'date' | 'size'
```

## 4. 事件与交互逻辑

### 场景一：bindMenu 点击弹出菜单

```typescript
Button('更多操作')
  .bindMenu([
    {
      value: '分享',
      action: (): void => {
        this.handleShare()
      }
    },
    {
      value: '收藏',
      action: (): void => {
        this.handleFavorite()
      }
    },
    {
      value: '删除',
      action: (): void => {
        this.handleDelete()
      }
    }
  ])
```

### 场景二：bindMenu 使用自定义 Menu 组件

```typescript
@Builder
buildSortMenu(): void {
  Menu() {
    MenuItem({ content: '按名称排序' })
      .onClick((): void => { this.sortMode = 'name' })
    MenuItem({ content: '按日期排序' })
      .onClick((): void => { this.sortMode = 'date' })
    MenuItem({ content: '按大小排序' })
      .onClick((): void => { this.sortMode = 'size' })
  }
}

// 在 build 中使用
Button('排序')
  .bindMenu(this.buildSortMenu)
```

### 场景三：bindContextMenu 长按弹出菜单

```typescript
@Builder
buildContextMenu(): void {
  Menu() {
    MenuItem({ content: '编辑', labelInfo: 'Ctrl+E' })
      .onClick((): void => { this.editItem() })
    MenuItem({ content: '复制', labelInfo: 'Ctrl+C' })
      .onClick((): void => { this.copyItem() })
    MenuItem({ content: '删除' })
      .onClick((): void => { this.deleteItem() })
  }
}

Text(this.itemName)
  .bindContextMenu(this.buildContextMenu, ResponseType.LongPress)
```

### 场景四：多级子菜单

```typescript
@Builder
buildSubMenu(): void {
  Menu() {
    MenuItem({ content: '图标视图' })
    MenuItem({ content: '列表视图' })
  }
}

@Builder
buildMainMenu(): void {
  Menu() {
    MenuItem({ content: '新建文件夹' })
    MenuItem({
      content: '查看方式',
      builder: (): void => this.buildSubMenu()
    })
  }
}
```

## 5. 数据结构

```typescript
interface MenuActionItem {
  value: string
  action: () => void
  icon?: ResourceStr
  enabled?: boolean
}

interface ContextMenuConfig {
  items: MenuActionItem[]
  responseType: ResponseType
  placement?: Placement
}
```

## 6. 联动说明

- 点击菜单项"排序方式" → 更新排序状态 → 列表重新排列
- 长按列表项 → 弹出 contextMenu → 选择"删除" → 弹出确认 Dialog → 确认后删除
- 编辑模式切换 → 菜单项的 enabled 状态联动变化
- 菜单选择"分享" → 调用系统分享能力
- 当绑定菜单的组件销毁时 → 菜单自动消失

## 7. 完整代码示例

```typescript
interface FileItem {
  name: string
  size: string
  date: string
}

@Entry
@Component
struct MenuDemoPage {
  @State fileList: FileItem[] = [
    { name: '项目文档.pdf', size: '2.3MB', date: '2025-03-15' },
    { name: '设计稿.png', size: '5.1MB', date: '2025-03-10' },
    { name: '会议记录.txt', size: '128KB', date: '2025-03-08' }
  ]
  @State sortMode: string = 'date'
  @State currentFile: string = ''

  @Builder
  buildSortMenu(): void {
    Menu() {
      MenuItemGroup({ header: '排序方式' }) {
        MenuItem({ content: '按名称' })
          .onClick((): void => { this.sortMode = 'name' })
        MenuItem({ content: '按日期' })
          .onClick((): void => { this.sortMode = 'date' })
        MenuItem({ content: '按大小' })
          .onClick((): void => { this.sortMode = 'size' })
      }
    }
  }

  @Builder
  buildFileContextMenu(): void {
    Menu() {
      MenuItem({ content: '重命名' })
        .onClick((): void => {
          console.info('rename: ' + this.currentFile)
        })
      MenuItem({ content: '复制' })
        .onClick((): void => {
          console.info('copy: ' + this.currentFile)
        })
      MenuItem({ content: '删除' })
        .onClick((): void => {
          const idx = this.fileList.findIndex((f: FileItem): boolean => f.name === this.currentFile)
          if (idx >= 0) {
            this.fileList.splice(idx, 1)
          }
        })
    }
  }

  getSortedList(): FileItem[] {
    const list = this.fileList.slice()
    if (this.sortMode === 'name') {
      list.sort((a: FileItem, b: FileItem): number => a.name.localeCompare(b.name))
    } else if (this.sortMode === 'date') {
      list.sort((a: FileItem, b: FileItem): number => b.date.localeCompare(a.date))
    }
    return list
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        Text('文件列表').fontSize(22).fontWeight(FontWeight.Bold)
        Blank()
        Button('排序')
          .bindMenu(this.buildSortMenu)
      }
      .width('100%')

      ForEach(this.getSortedList(), (item: FileItem) => {
        Row() {
          Column() {
            Text(item.name).fontSize(16)
            Text(`${item.size}  ${item.date}`)
              .fontSize(12)
              .fontColor('#999')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(12)
        .borderRadius(8)
        .backgroundColor('#F5F5F5')
        .bindContextMenu(this.buildFileContextMenu, ResponseType.LongPress)
        .onTouch((event: TouchEvent): void => {
          if (event.type === TouchType.Down) {
            this.currentFile = item.name
          }
        })
      })
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ Menu 单独使用，没有配合 bindMenu / bindContextMenu
// Menu 不能作为普通组件直接放在布局中
build() {
  Column() {
    Menu() {
      MenuItem({ content: '选项' })
    }
  }
}

// ❌ bindContextMenu 中嵌套 bindMenu，不支持多级嵌套弹出
Text('test')
  .bindContextMenu(this.menuBuilder, ResponseType.LongPress)
  // 在 menuBuilder 内部又使用 bindMenu → 不生效

// ❌ 菜单项没有 action 回调，点击无效果
Button('菜单')
  .bindMenu([
    { value: '选项A' }  // 缺少 action
  ])

// ❌ 在 CustomBuilder 中使用 bindMenu 弹出多级菜单
// 应使用 MenuItem 的 builder 参数实现子菜单
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Menu()` | 菜单容器，需配合 bindMenu/bindContextMenu |
| `MenuItem({ content, startIcon?, endIcon?, labelInfo?, builder? })` | 菜单项 |
| `MenuItemGroup({ header?, footer? })` | 菜单分组 |
| `.bindMenu(content, options?)` | 点击绑定菜单 |
| `.bindMenu(isShow, content, options?)` | 状态控制菜单显隐（API 11+） |
| `.bindContextMenu(builder, responseType, options?)` | 长按/右键绑定上下文菜单（API 8+） |
| `ResponseType.LongPress` | 长按触发 |
| `ResponseType.RightClick` | 右键触发 |
| `.font(Font)` | Menu 统一设置文本字体（API 10+） |
| `.fontColor(ResourceColor)` | Menu 统一设置文本颜色（API 10+） |
| `.radius(Dimension \| BorderRadiuses)` | Menu 圆角半径（API 10+） |
| `.subMenuExpandingMode(mode)` | 子菜单展开样式（API 12+） |
| `SubMenuExpandingMode.SIDE_EXPAND` | 侧边展开（默认） |
| `SubMenuExpandingMode.EMBEDDED_EXPAND` | 嵌入展开 |
| `SubMenuExpandingMode.STACK_EXPAND` | 堆叠展开 |
| `Placement` | 菜单弹出位置枚举 |

> **注意**：Menu 不支持单独使用，必须配合 bindMenu 或 bindContextMenu。bindContextMenu 仅在子窗中显示。菜单最大宽度受设备栅格限制。
