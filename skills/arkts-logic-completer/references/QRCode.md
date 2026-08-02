# QRCode 组件功能逻辑规格

## 1. 功能定位

QRCode 是二维码组件，用于显示单个二维码图案。当界面需要展示可扫描的二维码（如分享链接、支付码、设备配对）时使用。

## 2. 典型场景

- 个人名片页展示分享二维码
- 支付页面生成付款码
- Wi-Fi 密码分享二维码
- 设备配对/绑定扫码页

## 3. 状态声明

```typescript
// 二维码内容
@State qrContent: string = 'https://example.com'

// 动态二维码（如支付码定时刷新）
@State payCode: string = ''
```

## 4. 事件与交互逻辑

QRCode 组件没有专属事件，核心是通过数据驱动内容变化：

### 静态展示

```typescript
QRCode('https://example.com')
  .width(200)
  .height(200)
```

### 动态内容

```typescript
QRCode(this.qrContent)
  .width(200)
  .height(200)
  .color(Color.Black)
  .backgroundColor(Color.White)
```

### 定时刷新

```typescript
refreshPayCode(): void {
  this.payCode = 'PAY_' + Date.now().toString()
}
```

## 5. 数据结构

```typescript
interface ShareInfo {
  title: string
  url: string
  qrContent: string
}
```

## 6. 联动说明

- 用户输入内容 → 实时更新二维码展示
- 定时器触发 → 刷新支付码内容
- 长按二维码 → 弹出保存/分享菜单（需配合手势事件）
- 页面切换 → 重新生成新的二维码内容

## 7. 完整代码示例

```typescript
@Entry
@Component
struct SharePage {
  @State shareUrl: string = 'https://example.com/share?id=123'
  @State inputText: string = ''

  build() {
    Column({ space: 20 }) {
      Text('我的分享码')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)

      QRCode(this.shareUrl)
        .width(200)
        .height(200)
        .color('#333333')
        .backgroundColor(Color.White)

      Text(this.shareUrl)
        .fontSize(12)
        .fontColor('#999999')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('80%')
        .textAlign(TextAlign.Center)

      Divider().margin({ top: 16 })

      Text('自定义二维码内容').fontSize(16)

      TextInput({ placeholder: '输入内容生成二维码', text: this.inputText })
        .width('80%')
        .onChange((value: string): void => {
          this.inputText = value
        })

      Button('生成二维码')
        .width('80%')
        .enabled(this.inputText.length > 0)
        .onClick((): void => {
          this.shareUrl = this.inputText
        })
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 传入空字符串，生成无效二维码
QRCode('')

// ❌ 内容超过 512 字符会被截取，长文本应使用短链
QRCode('非常长的字符串......')  // 超过512字符会截断

// ❌ 没有设置宽高，二维码可能太小无法扫描
QRCode('https://example.com')
// 应至少设置 .width(140).height(140)

// ❌ 二维码颜色和背景色太接近，无法识别
QRCode('hello').color('#EEEEEE').backgroundColor(Color.White)
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `QRCode(value: string)` | 创建二维码，最大支持 512 字符 |
| `.color(ResourceColor)` | 二维码前景色，默认黑色 |
| `.backgroundColor(ResourceColor)` | 背景色，默认白色 |
| `.contentOpacity(number \| Resource)` | 内容不透明度，范围 [0, 1]（API 11+） |
