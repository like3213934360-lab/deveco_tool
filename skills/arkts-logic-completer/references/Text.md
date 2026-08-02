# Text 组件功能逻辑规格

## 1. 功能定位

Text 是文本显示组件，用于展示一段静态或动态文本内容。当界面需要显示标题、正文、标签、提示信息等各类文字内容时使用。

## 2. 典型场景

- 页面标题与副标题
- 列表项中的文字内容（名称、描述、价格）
- 状态提示文字（加载中、暂无数据、错误提示）
- 可复制/可选择的文本段落

## 3. 状态声明

```typescript
// 动态文本内容
@State title: string = ''
@State content: string = ''

// 可选择文本
@State selectedText: string = ''

// 文本溢出控制
@State isExpanded: boolean = false

// 动态样式
@State textColor: string = '#333333'  // ResourceColor
@State textSize: number = 16
```

## 4. 事件与交互逻辑

### onClick 核心事件

Text 的 onClick 常用于可点击文字（如超链接、"查看更多"）：

```typescript
Text('查看全部')
  .fontColor('#0A59F7')
  .fontSize(14)
  .onClick((): void => {
    router.pushUrl({ url: 'pages/AllItems' })
  })
```

### 场景一：展开/收起长文本

```typescript
@State isExpanded: boolean = false
@State longText: string = '这是一段很长的文本内容...'

Column() {
  Text(this.longText)
    .fontSize(14)
    .fontColor('#333')
    .maxLines(this.isExpanded ? undefined : 3)
    .textOverflow({ overflow: TextOverflow.Ellipsis })

  Text(this.isExpanded ? '收起' : '展开')
    .fontColor('#0A59F7')
    .fontSize(14)
    .margin({ top: 4 })
    .onClick((): void => {
      this.isExpanded = !this.isExpanded
    })
}
```

### 场景二：可复制文本

```typescript
Text('订单号：202604120001')
  .fontSize(14)
  .copyOption(CopyOptions.LocalDevice)
  .textSelectable(TextSelectableMode.SELECTABLE_FOCUSABLE)
```

### 场景三：富文本样式（Span 子组件）

```typescript
Text() {
  Span('价格：')
    .fontSize(14)
    .fontColor('#999')
  Span('¥199')
    .fontSize(20)
    .fontColor('#FF6B00')
    .fontWeight(FontWeight.Bold)
  Span(' /件')
    .fontSize(12)
    .fontColor('#999')
}
```

### 场景四：跑马灯文本

```typescript
Text('这是一段很长的通知公告信息，需要滚动展示给用户阅读')
  .width(200)
  .maxLines(1)
  .textOverflow({ overflow: TextOverflow.MARQUEE })
```

## 5. 数据结构

```typescript
interface TextStyleConfig {
  fontSize: number
  fontColor: string  // ResourceColor
  fontWeight: FontWeight
  lineHeight: number
  letterSpacing: number
  maxLines: number
}

interface RichTextSegment {
  text: string
  style: TextStyleConfig
}

interface ExpandableTextConfig {
  content: string
  maxLines: number
  expandText: string
  collapseText: string
}
```

## 6. 联动说明

- 数据请求完成 → @State 文本变量更新 → Text 组件自动刷新
- 文本内容为空 → 显示占位提示文字（"暂无数据"）
- 文本超出 maxLines → 显示省略号 → 点击"展开"切换 maxLines
- 复制文本内容 → onCopy 回调 → 可 Toast 提示"已复制"
- 多语言切换 → 使用 $r('app.string.xxx') 资源引用 → 文本自动更新

## 7. 完整代码示例

```typescript
@Entry
@Component
struct ArticleDetailPage {
  @State title: string = 'HarmonyOS ArkUI 开发指南'
  @State author: string = '华为开发者'
  @State publishTime: string = '2026-04-12'
  @State content: string = 'ArkUI 是 HarmonyOS 的声明式 UI 框架，提供了丰富的组件和灵活的布局能力。本文将详细介绍如何使用 ArkUI 构建高质量的跨设备应用界面，包括组件的使用方法、状态管理机制以及最佳实践等内容。开发者可以通过 ArkUI 快速构建出美观且高性能的应用界面。'
  @State isContentExpanded: boolean = false
  @State likeCount: number = 128
  @State isLiked: boolean = false

  build() {
    Column() {
      Text(this.title)
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor('#1A1A1A')
        .width('100%')
        .lineHeight(30)

      Row({ space: 12 }) {
        Text(this.author)
          .fontSize(13)
          .fontColor('#0A59F7')
        Text(this.publishTime)
          .fontSize(13)
          .fontColor('#999')
      }
      .width('100%')
      .margin({ top: 8, bottom: 16 })

      Text(this.content)
        .fontSize(16)
        .fontColor('#333')
        .lineHeight(26)
        .letterSpacing(0.5)
        .maxLines(this.isContentExpanded ? undefined : 3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .copyOption(CopyOptions.LocalDevice)
        .width('100%')

      if (this.content.length > 80) {
        Text(this.isContentExpanded ? '收起全文' : '展开全文')
          .fontColor('#0A59F7')
          .fontSize(14)
          .margin({ top: 4 })
          .onClick((): void => {
            this.isContentExpanded = !this.isContentExpanded
          })
      }

      Divider()
        .margin({ top: 20, bottom: 20 })
        .color('#F0F0F0')

      Text('相关标签')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor('#333')
        .width('100%')
        .margin({ bottom: 8 })

      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(['ArkUI', 'HarmonyOS', '前端开发', '声明式UI'], (tag: string) => {
          Text(tag)
            .fontSize(12)
            .fontColor('#0A59F7')
            .backgroundColor('#E8F0FE')
            .borderRadius(4)
            .padding({ left: 10, right: 10, top: 4, bottom: 4 })
            .margin({ right: 8, bottom: 8 })
        })
      }
      .width('100%')

      Blank()

      Row() {
        Text() {
          Span(this.isLiked ? '❤ ' : '♡ ')
            .fontSize(18)
          Span(this.likeCount.toString())
            .fontSize(14)
            .fontColor(this.isLiked ? '#FF4D4F' : '#999')
        }
        .onClick((): void => {
          this.isLiked = !this.isLiked
          this.likeCount = this.isLiked ? this.likeCount + 1 : this.likeCount - 1
        })

        Blank()

        Text('分享')
          .fontSize(14)
          .fontColor('#0A59F7')
          .onClick((): void => {
            console.info('share article')
          })
      }
      .width('100%')
      .padding({ top: 12, bottom: 12 })
    }
    .width('100%')
    .height('100%')
    .padding(20)
  }
}
```

## 8. 反面示例

```typescript
// ❌ maxLines 和 textOverflow 只设了一个，省略号不生效
Text('很长的文本...')
  .maxLines(2)
  // 缺少 .textOverflow({ overflow: TextOverflow.Ellipsis })

// ❌ 使用 textOverflow 的 MARQUEE 但没限制 maxLines 为 1
Text('跑马灯文本')
  .textOverflow({ overflow: TextOverflow.MARQUEE })
  // MARQUEE 需要 maxLines(1) 才能正常工作

// ❌ 动态文本为空时没有占位处理
Text(this.userName)
  // 如果 userName 是空字符串，Text 高度塌缩，影响布局

// ❌ 将业务逻辑放在 Text 的 content 拼接中，不好维护
Text('共' + this.list.filter(i => i.selected).length + '项，总计¥' +
  this.list.filter(i => i.selected).reduce((sum, i) => sum + i.price, 0).toFixed(2))

// ❌ copyOption 设置了但 textSelectable 没设置，长按无法选中
Text('可复制文本')
  .copyOption(CopyOptions.LocalDevice)
  // 缺少 .textSelectable(TextSelectableMode.SELECTABLE_FOCUSABLE)
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Text(content?)` | 创建文本组件，支持 string / Resource |
| `Span(text)` | 文本子组件，用于图文混排和富文本 |
| `ImageSpan(src)` | 图片子组件，行内图片 |
| `.fontSize(number \| string \| Resource)` | 字体大小 |
| `.fontColor(ResourceColor)` | 字体颜色 |
| `.fontWeight(FontWeight \| number)` | 字体粗细 |
| `.fontStyle(FontStyle)` | 字体样式：Normal / Italic |
| `.fontFamily(string \| Resource)` | 字体族 |
| `.textAlign(TextAlign)` | 水平对齐：Start / Center / End |
| `.lineHeight(number \| string \| Resource)` | 行高 |
| `.letterSpacing(number \| string)` | 字间距 |
| `.maxLines(number)` | 最大行数 |
| `.textOverflow(options)` | 溢出方式：Ellipsis / Clip / MARQUEE / None |
| `.ellipsisMode(EllipsisMode)` | 省略位置：START / CENTER / END（API 11+） |
| `.wordBreak(WordBreak)` | 断行规则：NORMAL / BREAK_ALL / BREAK_WORD |
| `.decoration(TextDecorationOptions)` | 装饰线：Underline / LineThrough / Overline |
| `.textShadow(ShadowOptions)` | 文字阴影 |
| `.textCase(TextCase)` | 大小写转换：Normal / LowerCase / UpperCase |
| `.baselineOffset(number)` | 基线偏移 |
| `.textIndent(Dimension)` | 首行缩进 |
| `.copyOption(CopyOptions)` | 复制模式：None / InApp / LocalDevice / CROSS_DEVICE |
| `.textSelectable(TextSelectableMode)` | 文本选择模式（API 12+） |
| `.selection(start, end)` | 设置选中区域 |
| `.selectedBackgroundColor(color)` | 选中底板颜色 |
| `.minFontSize / .maxFontSize` | 自适应字号范围（需配合 maxLines 或布局限制） |
| `.heightAdaptivePolicy(policy)` | 自适应方式：MAX_LINES_FIRST / MIN_FONT_SIZE_FIRST |
| `.lineSpacing(LengthMetrics)` | 行间距（API 12+） |
| `.marqueeOptions(options)` | 跑马灯配置（API 18+） |
| `.enableDataDetector(boolean)` | 文本实体识别（API 11+） |
| `.editMenuOptions(EditMenuOptions)` | 自定义菜单扩展 |
| `.onClick(callback)` | 点击事件 |

> **注意**：`maxLines` 需要配合 `textOverflow` 使用，否则文字虽不显示超出部分但无省略号提示。MARQUEE 模式要求 `maxLines(1)` 且组件宽度有限制。
