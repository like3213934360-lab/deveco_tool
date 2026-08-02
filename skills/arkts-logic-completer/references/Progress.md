# Progress 组件功能逻辑规格

## 1. 功能定位

Progress 是进度条组件，用于显示内容加载或操作处理的进度。当界面需要向用户反馈任务完成程度（如下载、上传、安装）时使用。

## 2. 典型场景

- 文件下载/上传进度显示
- 应用安装进度（胶囊形带文字）
- 加载更新检查（环形 loading 动效）
- 任务完成百分比展示（线性进度条）
- 数据同步进度反馈

## 3. 状态声明

```typescript
// 当前进度值
@State progressValue: number = 0

// 进度总量
@State totalValue: number = 100

// 是否正在加载
@State isLoading: boolean = false
```

## 4. 事件与交互逻辑

Progress 本身没有用户交互事件，核心是通过状态驱动进度更新：

### 进度更新

```typescript
Progress({ value: this.progressValue, total: this.totalValue, type: ProgressType.Linear })
  .width('80%')
```

### 模拟异步进度

```typescript
async startDownload(): Promise<void> {
  this.isLoading = true
  this.progressValue = 0
  const interval = setInterval((): void => {
    if (this.progressValue >= 100) {
      clearInterval(interval)
      this.isLoading = false
      return
    }
    this.progressValue += 10
  }, 500)
}
```

### 环形 Loading 状态

```typescript
Progress({ value: 0, total: 100, type: ProgressType.Ring })
  .style({ strokeWidth: 20, status: ProgressStatus.LOADING })
```

## 5. 数据结构

```typescript
interface DownloadTask {
  fileName: string
  totalSize: number
  downloadedSize: number
  status: string  // 'waiting' | 'downloading' | 'completed' | 'failed'
}
```

## 6. 联动说明

- 下载开始 → Progress 从 0 开始递增
- Progress 达到 100% → 显示"完成"提示，隐藏进度条
- 网络异常 → Progress 暂停，显示重试按钮
- 多文件下载 → 列表中每项展示各自 Progress
- 胶囊形 Progress 可显示进度文字（如 "安装中... 70%"）

## 7. 完整代码示例

```typescript
interface DownloadTask {
  fileName: string
  progress: number
  status: string
}

@Entry
@Component
struct DownloadPage {
  @State tasks: DownloadTask[] = [
    { fileName: '文件A.zip', progress: 0, status: 'waiting' },
    { fileName: '文件B.pdf', progress: 0, status: 'waiting' }
  ]
  @State isCheckingUpdate: boolean = false

  startDownload(index: number): void {
    this.tasks[index] = {
      fileName: this.tasks[index].fileName,
      progress: 0,
      status: 'downloading'
    }
    const interval = setInterval((): void => {
      const current = this.tasks[index].progress
      if (current >= 100) {
        clearInterval(interval)
        this.tasks[index] = {
          fileName: this.tasks[index].fileName,
          progress: 100,
          status: 'completed'
        }
        return
      }
      this.tasks[index] = {
        fileName: this.tasks[index].fileName,
        progress: current + 20,
        status: 'downloading'
      }
    }, 500)
  }

  build() {
    Column({ space: 16 }) {
      Text('下载管理').fontSize(20).fontWeight(FontWeight.Bold)

      // 检查更新（环形 loading）
      Row({ space: 12 }) {
        if (this.isCheckingUpdate) {
          Progress({ value: 0, total: 100, type: ProgressType.Ring })
            .width(40)
            .height(40)
            .color(Color.Blue)
            .style({ strokeWidth: 4, status: ProgressStatus.LOADING })
          Text('检查更新中...').fontSize(14)
        } else {
          Button('检查更新')
            .onClick((): void => {
              this.isCheckingUpdate = true
              setTimeout((): void => {
                this.isCheckingUpdate = false
              }, 3000)
            })
        }
      }
      .padding(16)

      Divider()

      ForEach(this.tasks, (task: DownloadTask, index: number) => {
        Column({ space: 8 }) {
          Row() {
            Text(task.fileName).fontSize(14)
            Blank()
            if (task.status === 'waiting') {
              Button('下载').onClick((): void => { this.startDownload(index) })
            } else if (task.status === 'completed') {
              Text('已完成').fontColor('#52C41A')
            } else {
              Text(task.progress + '%').fontSize(12).fontColor('#999999')
            }
          }
          .width('100%')

          if (task.status === 'downloading') {
            Progress({ value: task.progress, total: 100, type: ProgressType.Linear })
              .width('100%')
              .color('#007DFF')
              .style({ strokeWidth: 8, enableSmoothEffect: true })
          }
        }
        .width('100%')
        .padding(16)
      })

      // 胶囊形带文字
      Text('安装进度').fontSize(14).padding({ left: 16, top: 16 })
      Progress({ value: 70, total: 100, type: ProgressType.Capsule })
        .width('80%')
        .height(40)
        .style({
          content: '安装中... 70%',
          font: { size: 14 },
          fontColor: Color.White,
          showDefaultPercentage: false
        })
    }
  }
}
```

## 8. 反面示例

```typescript
// ❌ value 超出 total 范围，不会报错但会被截断
Progress({ value: 150, total: 100, type: ProgressType.Linear })

// ❌ 进度没有用 @State 管理，更新后不刷新
let progress = 50
Progress({ value: progress, total: 100, type: ProgressType.Linear })

// ❌ Ring 类型设置了 LOADING 状态却还设置 value（value 不生效）
Progress({ value: 50, total: 100, type: ProgressType.Ring })
  .style({ status: ProgressStatus.LOADING })

// ❌ type 和 style 不匹配
Progress({ value: 50, type: ProgressType.Linear })
  .style({ shadow: true })  // shadow 只对 Ring 类型生效
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Progress({ value, total?, type? })` | 创建进度条，type 默认 Linear |
| `ProgressType.Linear` | 线性进度条 |
| `ProgressType.Ring` | 环形无刻度 |
| `ProgressType.Eclipse` | 圆形（月相效果） |
| `ProgressType.ScaleRing` | 环形有刻度 |
| `ProgressType.Capsule` | 胶囊形（可带文字） |
| `.value(number)` | 动态更新进度值 |
| `.color(ResourceColor \| LinearGradient)` | 前景色，Ring 支持渐变（API 10+） |
| `.style(options)` | 样式设置，根据 type 使用对应 Options |
| `ProgressStatus.LOADING` | Ring 类型检查更新动效 |
| `.style({ enableSmoothEffect: true })` | 进度平滑动效（API 10+） |
| `.style({ content, showDefaultPercentage })` | Capsule 类型文字内容 |
