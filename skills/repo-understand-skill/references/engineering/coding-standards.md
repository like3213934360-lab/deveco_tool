# 编码规范

> **说明**：本文档是 ArkTS 工程的编码规范特例说明。
>
> 如需了解**通用 ArkTS 编码规范**，请参考 HarmonyOS 官方文档。

## 文件命名

### 组件
- 规范: `PascalCase`
- 示例: `DetailPageView.ets`, `ListView.ets`, `CreationPage.ets`

### 工具类
- 规范: `PascalCase`
- 示例: `DeviceInfo.ets`, `StringUtil.ets`, `UiUtil.ets`

### 常量
- 规范: `UPPER_SNAKE_CASE` + `Constants` 后缀
- 示例: `NavigationConstants.ets`, `MenuConstants.ets`, `LayoutConstants.ets`

### ViewModel
- 规范: `PascalCase` + `VM` 后缀
- 示例: `DetailPageVM.ets`, `ListPageVm.ets`, `ThumbnailVM.ets`

### Controller
- 规范: `PascalCase` + `Controller` 后缀
- 示例: `DetailPageController.ets`, `MenuController.ets`, `PlayerController.ets`

### Manager
- 规范: `PascalCase` + `Manager` 后缀
- 示例: `EventManager.ets`, `DataSourceManager.ets`, `ScreenManager.ets`

### Loader
- 规范: `PascalCase` + `Loader` 后缀
- 示例: `ListPageLoader.ets`, `DetailPageLoader.ets`

### Params
- 规范: `PascalCase` + `Params` 后缀
- 示例: `ListPageLoaderParams.ets`, `ContentLoaderParams.ets`

## 导入规范

### 系统模块
```typescript
import type { BusinessError } from '@ohos.base';
import data_preferences from '@ohos.data.preferences';
```

### 第三方模块
```typescript
import lazy { HdsTabs, HdsTabsAttribute, HdsTabsController } from '@kit.UIDesignKit';
import lazy { AnimatorOptions, AnimatorResult, uiObserver } from '@kit.ArkUI';
```

### 项目模块（使用精准导入）
```typescript
// ✅ 正确：使用懒加载和精准导入
import lazy { StringUtil } from '@myorg/mylib/src/main/ets/default/utils/StringUtil';
import lazy { DeviceInfo } from '@myorg/mylib/src/main/ets/default/utils/DeviceInfo';
import lazy { DetailPageVM } from '@myorg/featurelib';
import lazy { ListPageLoaderParams } from '@ohos/listpage/src/main/ets/view/ListPageLoaderParams';

// ❌ 错误：直接导入
import { StringUtil } from '@myorg/mylib/src/main/ets/default/utils/StringUtil';
```

### 大SO文件懒加载
```typescript
// ✅ 正确：大SO文件使用动态导入
(): void => {
  import('@myorg/mylib/src/main/ets/default/xxx').then((ns) => {
    ns.xxx(getContext(), records);
  }
}

// ❌ 错误：在文件顶部直接导入大SO文件
import { BigSoModule } from '@myorg/mylib/src/main/ets/default/BigSoModule';
```

## 装饰器使用

### 组件相关
```typescript
@Component              // 组件定义
@Builder                // 构建函数
@Entry                  // 入口组件
@Reusable               // 可复用组件
```

### 状态管理
```typescript
@State                  // 组件内部状态
@Prop                   // 父组件传入的属性（单向）
@Link                   // 双向绑定
@Provide                // 提供依赖注入
@Consume                // 消费依赖注入
@Observed               // 观察对象类
@ObjectLink             // 观察对象属性
@Watch                  // 状态监听
```

### 其他
```typescript
@Preview                // 预览
@CustomDialog           // 自定义弹窗
@Styles                 // 样式
```

## 注释规范

### 文件头注释
```typescript
/*
 * Copyright (c) 2023-2023 Your Organization. All rights reserved.
 */
```

### 类/接口注释
```typescript
/**
 * 详情页控制器
 *
 * 负责详情页面的业务逻辑控制
 */
@Component
export struct DetailPageController {
  // ...
}
```

### 方法注释
```typescript
/**
 * 加载数据
 *
 * @param uri 数据URI
 * @param size 数据尺寸
 * @returns 加载结果，成功返回 true，失败返回 false
 */
private loadData(uri: string, size: Size): boolean {
  // 实现
  return true;
}
```

### 复杂逻辑注释
```typescript
// 计算缩放比例，保持宽高比
const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
```

## 性能优化规范

### 1. 懒加载

**原因**: 避免冷启动性能问题

**规范**:
```typescript
// ✅ 正确：使用懒加载
import lazy { DetailPageVM } from '@myorg/featurelib';

// ❌ 错误：直接导入
import { DetailPageVM } from '@myorg/featurelib';
```

### 2. 虚拟列表

**用于**: 大量数据展示（列表、分组）

**组件**: `LazyForEach`

**示例**:
```typescript
LazyForEach(this.dataSource, (item: MediaItem, index: number) => {
  PhotoGridItem({ mediaItem: item })
}, (item: MediaItem, index: number) => `${item.uri}_${index}`)
```

**注意**: 第三个参数是 key 生成函数，必须唯一且稳定

### 3. 组件复用

**使用**: `@Reusable` 装饰器

```typescript
@Reusable
@Component
export struct PhotoGridItem {
  @Prop mediaItem: MediaItem;

  aboutToReuse(params: Record<string, Object>): void {
    this.mediaItem = params['mediaItem'] as MediaItem;
  }
}
```

### 4. 避免频繁状态更新

```typescript
// ✅ 正确：批量更新
this.is_loading = true;
this.data = newData;
this.is_loading = false;

// ❌ 错误：频繁更新
for (let i = 0; i < items.length; i++) {
  this.currentItem = items[i];  // 每次都触发更新
}
```

### 5. 使用 `@Track` 优化观察对象

```typescript
@Observed
class MediaData {
  @Track uri: string = '';        // 需要观察的属性
  @Track name: string = '';
  @Track width: number = 0;

  tempValue: string = '';         // 不需要观察的属性，不加 @Track
}
```

## 命名约定

### 变量
```typescript
// 私有变量：下划线开头
private _dataSource: TimelineDataSource;

// 公共变量：驼峰命名
public currentIndex: number;

// 常量：大写下划线
private readonly MAX_COUNT: number = 100;

// 静态变量：大写下划线
private static readonly TAG: string = 'DetailPage';
```

### 方法
```typescript
// 私有方法：下划线开头
private _loadData(): void {}

// 公共方法：驼峰命名
public loadData(): void {}

// 事件处理：on + 动作
private onClick(): void {}
private onAppear(): void {}
private onIndexChanged(): void {}

// 回调：handle + 事件
private handleDataChange(): void {}
```

### 类型
```typescript
// 接口：I 开头或直接用 interface
interface DataSource {}
interface IDataSource {}

// 枚举：大写下划线
enum CategoryType {
  LOCATION = 'location',
  PORTRAIT = 'portrait'
}

// 类型别名：PascalCase
type MediaItem = PhotoItem | VideoItem;
```

## 代码组织

### 组件结构
```typescript
@Component
export struct MyComponent {
  // 1. 状态变量
  @State private isLoading: boolean = false;
  @Prop private data: DataItem;

  // 2. 常量
  private readonly TAG: string = 'MyComponent';
  private readonly MAX_SIZE: number = 100;

  // 3. 生命周期
  aboutToAppear(): void {}
  aboutToDisappear(): void {}

  // 4. 公共方法
  public refresh(): void {}

  // 5. 私有方法
  private _loadData(): void {}
  private _handleClick(): void {}

  // 6. 构建函数
  build() {
    Column() {}
  }
}
```

### 导入顺序
```typescript
// 1. 系统模块
import type { BusinessError } from '@ohos.base';

// 2. 第三方模块
import lazy { HdsTabs } from '@kit.UIDesignKit';

// 3. 项目公共模块
import lazy { StringUtil } from '@myorg/mylib/src/main/ets/default/utils/StringUtil';

// 4. 项目功能模块
import lazy { DetailPageVM } from '@myorg/featurelib';

// 5. 相对路径导入
import { MyComponent } from './MyComponent';
```

## 错误处理

```typescript
// ✅ 正确：使用 BusinessError
import type { BusinessError } from '@ohos.base';
import hilog from '@ohos.hilog';

const TAG: string = 'MyModule';
const DOMAIN: number = 0x0001;

try {
  // 可能出错的代码
  dataPreferences.getPreferences(context, 'store');
} catch (err) {
  const error = err as BusinessError;
  hilog.error(DOMAIN, TAG, `Failed to get preferences. Code: ${error.code}, message: ${error.message}`);
}

// ❌ 错误：不处理错误
dataPreferences.getPreferences(context, 'store');
```

## 日志规范

```typescript
import hilog from '@ohos.hilog';

const TAG: string = 'MyComponent';
const DOMAIN: number = 0x0001;  // 日志域，0x0001 ~ 0xFFFF

// 不同级别日志
hilog.debug(DOMAIN, TAG, 'Debug message');
hilog.info(DOMAIN, TAG, 'Info message');
hilog.warn(DOMAIN, TAG, 'Warning message');
hilog.error(DOMAIN, TAG, 'Error message');

// 日志中不要输出敏感信息
// ❌ 错误
hilog.info(DOMAIN, TAG, `User password: %{public}s`, password);

// ✅ 正确
hilog.info(DOMAIN, TAG, 'User login attempt');
```

## TypeScript 规范

### 类型定义
```typescript
// ✅ 正确：明确类型
private currentIndex: number = 0;
private items: MediaItem[] = [];

// ❌ 错误：使用 any
private currentIndex: any = 0;
private items: any[] = [];
```

### 可空类型
```typescript
// ✅ 正确：明确可空
private data: DataItem | null = null;
private callback?: () => void;

// ❌ 错误：不明确可空
private data: DataItem = null;
```

### 只读
```typescript
// ✅ 正确：使用 readonly
private readonly MAX_SIZE: number = 100;

// ❌ 错误：不使用 readonly
private MAX_SIZE: number = 100;
```

## 样式规范

### 使用语义化样式
```typescript
// ✅ 正确：使用语义化颜色
.color($r('sys.color.ohos_id_color_primary'))
.backgroundColor($r('sys.color.ohos_id_color_background'))

// ❌ 错误：硬编码颜色
.color('#007DFF')
.backgroundColor('#FFFFFF')
```

### 样式复用
```typescript
// ✅ 正确：使用 @Styles
@Styles
function commonButtonStyle() {
  .width('100%')
  .height(48)
  .borderRadius(8)
}

Button('Click')
  .commonButtonStyle()

// ❌ 错误：重复样式
Button('Click')
  .width('100%')
  .height(48)
  .borderRadius(8)

Button('Click2')
  .width('100%')
  .height(48)
  .borderRadius(8)
```