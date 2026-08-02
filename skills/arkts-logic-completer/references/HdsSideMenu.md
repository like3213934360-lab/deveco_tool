# HdsSideMenu 组件功能逻辑规格

> HDS (UI Design Kit) 组件,**@ComponentV2** 装饰器,仅 Stage 模型可用。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsSideMenu.md](../../../hds参考文档/中文文档/HdsSideMenu.md)
> 配套容器:[HdsSideBar.md](HdsSideBar.md) —— HdsSideMenu 通常放在 HdsSideBar 的 `sideBarPanelBuilder` 里。

## 1. 功能定位

菜单栏样式组件,支持两级菜单 + 角标:

- **一级菜单**(`HdsSideMenuMainItem`,最多 5 个):图标 + 文本 + 可选二级菜单
- **二级菜单**(`HdsSideMenuSubItem`,每个一级下最多 5 个):纯文本 + 可选角标
- 每一级都支持 `HdsSideMenuBadgeParam` 角标(红点/数字/文本)
- `selectedIndex` 双向绑定选中项,`-1` 表示无选中

**起始版本**:6.0.0 (API 20)。

## 2. 典型场景

- 备忘录 App 左侧分类:全部备忘 / 收藏 / 加锁 / 最近删除 / 文件夹
- 邮箱应用的文件夹栏(收件箱 / 草稿 / 发件箱 / 垃圾箱)
- 文件管理:分类目录 + 未读计数角标

## 3. 状态声明

```typescript
import {
  HdsSideMenu,
  HdsSideMenuMainItem,
  HdsSideMenuSubItem,
  HdsSideMenuBadgeParam
} from '@kit.UIDesignKit'
import { SymbolGlyphModifier } from '@kit.ArkUI'

@Entry
@ComponentV2
struct NotesSide {
  @Local selectedIndex: number = 1
  @Local menuItems: HdsSideMenuMainItem[] = [
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.doc_plaintext')),
      label: '全部备忘'
    }),
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.star')),
      label: '收藏',
      badge: { count: 3, value: '' }
    })
  ]
}
```

> - `@ComponentV2` + `@Local`。
> - `menuItems` 每一项都必须 `new HdsSideMenuMainItem({...})`,**不能**用对象字面量。
> - `selectedIndex` 初始值 `-1` 表示无选中;`>= 0` 表示命中对应索引。

## 4. 事件与交互逻辑

### 双向绑定 selectedIndex

```typescript
HdsSideMenu({
  items: this.menuItems,
  selectedIndex: this.selectedIndex,
  $selectedIndex: (i: number) => {
    this.selectedIndex = i
  }
})
```

`$selectedIndex` 的签名是 `(selectedIndex: number) => void`,直接回写即可。

### 每项的 action 独立触发

```typescript
new HdsSideMenuMainItem({
  label: '加锁',
  action: () => {
    promptAction.openToast({ message: '点击加锁分类' })
  }
})
```

`action` 和 `$selectedIndex` 会同时触发:`action` 用于业务逻辑,`$selectedIndex` 负责高亮。

### 运行时更新角标

```typescript
this.menuItems[1].updateBadge({ count: 5, value: '' })
```

`updateBadge` 返回当前项自身,便于链式操作。注意 `HdsSideMenuMainItem` 和 `HdsSideMenuSubItem` 都有这个方法,且 **`@ObservedV2` 装饰**,更新后 UI 自动刷新。

### 最大内容行数

`maxItemTextLines` 默认 1,**取值必须 > 0 的整数**。超长文本按此行数截断,再超以 "..." 截断。

## 5. 数据结构

### HdsSideMenu 构造参数

| 参数 | 类型 | 装饰器 | 必填 | 说明 |
|------|------|--------|------|------|
| `items` | `HdsSideMenuMainItem[]` | `@Param` | 否 | 最多 5 项 |
| `selectedIndex` | `number` | `@Param @Require` | **是** | 当前选中索引,>= -1 |
| `$selectedIndex` | `OnSelectedIndexChange` | `@Event` | 否 | 选中变化回调 |
| `maxItemTextLines` | `number` | `@Param` | 否 | 默认 1 |

### HdsSideMenuMainItemParam(一级菜单构造参数)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `itemId` | `string` | 否 | 菜单 id(无障碍用) |
| `label` | `ResourceStr` | 否 | 菜单文字 |
| `action` | `Callback<void>` | 否 | 点击回调 |
| `icon` | `ResourceStr` | 否 | 一级图标(**优先级高于 symbol**) |
| `symbol` | `SymbolGlyphModifier` | 否 | 一级图标(SymbolGlyph 方式) |
| `hdsSideMenuSubItem` | `HdsSideMenuSubItem[]` | 否 | 二级菜单,最多 5 项 |
| `badge` | `HdsSideMenuBadgeParam` | 否 | 角标 |

### HdsSideMenuSubItemParam(二级菜单)

继承 `HdsSideMenuBaseItemParam`(itemId/label/action) + `badge`。二级菜单**没有图标**。

### HdsSideMenuBadgeParam

| 字段 | 类型 | 说明 |
|------|------|------|
| `count` | `number` | 0 不显示;1 显示小圆点("·");>99 显示 "99+";负数不支持 |
| `value` | `string` | 文本角标,超长换行 |

### OnSelectedIndexChange

`type OnSelectedIndexChange = (selectedIndex: number) => void`

## 6. 联动说明

- **标准组合**:`HdsSideBar.sideBarPanelBuilder` 内放 HdsSideMenu,`contentPanelBuilder` 放根据 `selectedIndex` 切换的内容。
- 当 `HdsSideBar.isShowSideBar = false` 时,HdsSideMenu 整体不渲染,`selectedIndex` 状态保持。
- 与 `NavPathStack` 联动:`$selectedIndex` 回调里 `pushPathByName`,把菜单项 id 映射到路由。
- `icon` + `symbol` 都设时,icon 优先。想要跟随主题变色的图标,用 `symbol` + `SymbolGlyphModifier.fontColor(...)`。

## 7. 完整代码示例

> 备忘录左侧菜单(放在 HdsSideBar 的侧边栏区),选中高亮 + 角标 + 点击切换内容。

```typescript
import {
  HdsSideBar,
  HdsSideMenu,
  HdsSideMenuMainItem
} from '@kit.UIDesignKit'
import { SymbolGlyphModifier } from '@kit.ArkUI'

@Entry
@ComponentV2
struct NotesApp {
  @Local isShowSidebar: boolean = true
  @Local selectedIndex: number = 0
  @Local items: HdsSideMenuMainItem[] = [
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.doc_plaintext')),
      label: '全部备忘',
      action: () => { console.info('pick: all') }
    }),
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.star')),
      label: '收藏',
      badge: { count: 3, value: '' },
      action: () => { console.info('pick: favorites') }
    }),
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.lock')),
      label: '加锁',
      action: () => { console.info('pick: locked') }
    }),
    new HdsSideMenuMainItem({
      symbol: new SymbolGlyphModifier($r('sys.symbol.trash')),
      label: '最近删除',
      badge: { count: 99, value: '' },
      action: () => { console.info('pick: trash') }
    })
  ]

  @Builder
  SideBarPanel() {
    Column() {
      HdsSideMenu({
        items: this.items,
        selectedIndex: this.selectedIndex,
        $selectedIndex: (i: number) => { this.selectedIndex = i }
      })
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }

  @Builder
  ContentPanel() {
    Column() {
      Text(`当前分类 index=${this.selectedIndex}`)
        .fontSize(18)
    }
    .padding(24)
  }

  @BuilderParam sideBarBuilder: () => void = this.SideBarPanel
  @BuilderParam contentBuilder: () => void = this.ContentPanel

  build() {
    HdsSideBar({
      sideBarPanelBuilder: (): void => { this.sideBarBuilder() },
      contentPanelBuilder: (): void => { this.contentBuilder() },
      isShowSideBar: this.isShowSidebar,
      $isShowSideBar: (v: boolean) => { this.isShowSidebar = !v }
    })
  }
}
```

## 8. 反面示例

### 错 1:对象字面量传 items

```typescript
items: [{ label: '全部' }]   // ❌
```

`items` 类型是 `HdsSideMenuMainItem[]`,必须是类实例。正解:`[new HdsSideMenuMainItem({ label: '全部' })]`。

### 错 2:一级菜单超过 5 个 / 二级菜单超过 5 个

超过后规格要求自动忽略,实际可能抛布局警告或截断显示。业务如需 > 5 项,应把次要项放到**二级菜单**或改用 List。

### 错 3:badge.count 传负数

```typescript
badge: { count: -1, value: '' }
```

规格明确不支持负数,效果未定义。想"不显示"时,传 `0` 或直接不设 `badge`。

### 错 4:selectedIndex 用 string

```typescript
@Local selectedIndex: string = '0'   // ❌
```

必须是 `number`。如需按 id 管理,自己维护 `id ↔ index` 映射表。

### 错 5:把 action 和 $selectedIndex 里写重复逻辑

```typescript
action: () => { this.navigateTo('favorites') }
// 同时在 $selectedIndex 里又 switch(i) 再 navigateTo
```

每次点击会跳转两次。统一做法:在 `$selectedIndex` 里统一处理导航,`action` 里只做菜单项自身特有的副作用(埋点等)。

## 9. API 速查

| 名称 | 类型 | 说明 |
|------|------|------|
| `HdsSideMenu` | `@ComponentV2` | 根组件 |
| `HdsSideMenuMainItem` | `@ObservedV2` class | 一级菜单实例,`new HdsSideMenuMainItem(param)` |
| `HdsSideMenuSubItem` | `@ObservedV2` class | 二级菜单实例 |
| `HdsSideMenuMainItem.getSideMenuSubItem()` | `(): HdsSideMenuSubItem[]` | 获取当前项下二级菜单 |
| `HdsSideMenuMainItem.updateBadge(badge?)` | `(b?: HdsSideMenuBadgeParam): HdsSideMenuMainItem` | 动态更新角标 |
| `HdsSideMenuSubItem.updateBadge(badge?)` | 同上 | 二级角标动态更新 |
| `HdsSideMenuBadgeParam` | `{ count?: number; value?: string }` | count=0 不显示;1 小红点;>99 显示 "99+" |
| `OnSelectedIndexChange` | `(selectedIndex: number) => void` | 选中回调 |
| `selectedIndex` | `number` | 必填,>= -1 |
| `maxItemTextLines` | `number` | 默认 1 |

**记忆锚点**:`new HdsSideMenuMainItem({ label, icon/symbol, badge, action, hdsSideMenuSubItem })`,最多 5+5,角标 count/value 二选一。
