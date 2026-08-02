# ArkTS 数据架构模式参考文档

> **说明**：本文档定义 HarmonyOS ArkTS 项目的数据架构模式，对应 methodology/understanding-modes.md 中"模式4：数据理解模式"的 Reference 文件。

## 1. 数据模型定义

### @Observed/@Track 响应式数据模型

**职责**：可被 UI 组件观察的数据模型，字段变更自动触发视图刷新

**识别特征**：
- 使用 `@Observed` 装饰 class（整类可观察）
- 使用 `@Track` 装饰字段（精确追踪字段级变更）
- 通过 `@ObjectLink` 在子组件中引用

```typescript
@Observed
export class MediaItem {
  @Track uri: string = '';          // @Track：字段级精确追踪，仅该字段变化时刷新
  @Track name: string = '';
  @Track size: number = 0;
  @Track dateModified: number = 0;
  @Track albumId: string = '';      // 关联字段：通过 albumId 引用 AlbumInfo
  duration: number = 0;             // 无 @Track：变更不触发局部刷新，整体刷新时生效
}
```

### interface 纯数据结构

**职责**：不可观察的纯数据结构，用于参数传递、API 响应等非 UI 场景

```typescript
export interface AlbumInfo {
  albumId: string;
  albumName: string;
  coverUri: string;
  count: number;
  albumType: AlbumType;
}
```

### enum 状态/类型枚举

```typescript
export enum AlbumType {
  NORMAL = 0,
  VIDEO = 1,
  SCREENSHOT = 2,
  FAVORITE = 3,
}

export enum LoadState {
  WAIT_TO_LOAD = 0,
  LOADING = 1,
  IDLE = 2,
}
```

---

## 2. 数据源模式 (DataSource)

### IDataSource 接口

**职责**：ArkUI 框架标准数据源接口，配合 `LazyForEach` 实现按需加载

```typescript
interface IDataSource {
  totalCount(): number;                                        // 数据总条数
  getData(index: number): Object;                              // 按索引获取数据项
  registerDataChangeListener(listener: DataChangeListener): void;   // 注册变更监听
  unregisterDataChangeListener(listener: DataChangeListener): void; // 注销变更监听
}
```

### DataSource 实现类

```typescript
export class TimelineDataSource implements IDataSource {
  private dataList: MediaItem[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number { return this.dataList.length; }
  getData(index: number): Object { return this.dataList[index]; }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) { this.listeners.push(listener); }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const pos = this.listeners.indexOf(listener);
    if (pos >= 0) { this.listeners.splice(pos, 1); }
  }

  // 业务方法：追加数据并通知刷新
  appendData(items: MediaItem[]): void {
    this.dataList.push(...items);
    this.listeners.forEach(l => l.onDataReloaded());
  }

  // 业务方法：刷新指定项
  updateItem(index: number, item: MediaItem): void {
    this.dataList[index] = item;
    this.listeners.forEach(l => l.onDataChange(index));
  }
}
```

### DataSourceManager 数据源管理器

**职责**：管理多个 DataSource 实例，支持策略切换和生命周期管理

```typescript
export class DataSourceManager {
  private sources: Map<string, IDataSource> = new Map();

  register(key: string, source: IDataSource): void { this.sources.set(key, source); }
  get(key: string): IDataSource | undefined { return this.sources.get(key); }
  switchDataSource(key: string): void { /* 切换当前活跃数据源 */ }
  releaseAll(): void { this.sources.clear(); }
}
```

### 数据加载状态机

```yaml
状态转换:
  WAIT_TO_LOAD → LOADING : 调用 reloadData()/loadMore()
  LOADING     → IDLE     : 数据加载完成，通知 listeners
  IDLE        → WAIT_TO_LOAD: 数据变更需重新加载
```

---

## 3. 数据关系建模

ArkTS 通过引用字段表达关系。

### belongsTo — 一个模型属于另一个

```typescript
@Observed
export class MediaItem {
  @Track uri: string = '';
  @Track albumId: string = '';   // belongsTo：通过 albumId 关联 AlbumInfo
  // 查询方式：通过 albumId 查找 AlbumInfo
}
```

### hasMany — 一个模型拥有多个

```typescript
@Observed
export class AlbumInfo {
  @Track albumId: string = '';
  @Track albumName: string = '';
  // hasMany：Album 拥有多个 MediaItem
  // 查询方式：通过 albumId 筛选 MediaItem 列表
}
```

### hasOne — 一个模型拥有一个附属对象

```typescript
@Observed
export class UserSetting {
  @Track userId: string = '';      // hasOne：通过 userId 关联 UserProfile
  @Track themeMode: string = 'light';
}
```

**ArkTS 关系表达方式**：

| 关系类型 | ArkTS 实现方式 |
|----------|---------------|
| belongsTo | albumId: string 关联字段 |
| hasMany | 通过 albumId 筛选列表 |
| hasOne | userId: string 关联字段 |
| 多对多 | 通过中间集合/映射维护 |

---

## 4. 数据持久化方案

### AppStorage 全局状态持久化

```typescript
// 双向同步：组件修改直接写回 AppStorage
@StorageLink('selectedAlbum') selectedAlbum: string = '';

// 单向同步：组件只读，AppStorage 变化时刷新组件
@StorageProp('themeMode') themeMode: string = 'light';
```

### LocalStorage 局部状态持久化

```typescript
// 双向同步（限于当前 Ability 页面栈）
@LocalStorageLink('currentPage') currentPage: number = 0;

// 单向同步（限于当前 Ability 页面栈）
@LocalStorageProp('filterType') filterType: AlbumType = AlbumType.NORMAL;
```

### Preferences 轻量键值对存储

```typescript
import { preferences } from '@ohos.data.preferences';

// 适用场景：用户偏好、简单配置（最大约 8KB）
async function saveThemeMode(mode: string): Promise<void> {
  const store = await preferences.getPreferences(context, 'app_settings');
  await store.put('themeMode', mode);
  await store.flush();
}
```

### RDB 关系型数据库

```typescript
import { relationalStore } from '@ohos.data.relationalStore';

// 适用场景：结构化数据、复杂查询、事务操作
const STORE_CONFIG: relationalStore.StoreConfig = {
  name: 'gallery.db',
  securityLevel: relationalStore.SecurityLevel.S1,
};

async function createTable(store: relationalStore.RdbStore): Promise<void> {
  await store.executeSql(
    'CREATE TABLE IF NOT EXISTS favorites (uri TEXT PRIMARY KEY, added_at INTEGER)'
  );
}
```

### DataShare 跨应用数据共享

```typescript
import { dataShare } from '@ohos.data.dataShare';

// 适用场景：跨应用数据访问（如系统联系人、系统媒体库）
// 通过 DataShareExtensionAbility 提供数据
```

---

## 5. 数据访问层

### Helper 类 — 系统API封装

```typescript
import { photoAccessHelper } from '@ohos.file.photoAccessHelper';

// PhotoAccessHelper：系统相册数据访问
async function fetchAlbums(context: Context): Promise<AlbumInfo[]> {
  const helper = photoAccessHelper.getPhotoAccessHelper(context);
  const albums = await helper.getAlbums(photoAccessHelper.AlbumType.NORMAL);
  return albums.map(album => ({
    albumId: album.albumId,
    albumName: album.albumName,
    coverUri: album.coverUri,
    count: album.count,
  }));
}

// UserFileManagerAccess：用户文件管理
import { userFileManager } from '@ohos.file.userFileManager';
```

### ServiceConnector — 系统服务连接器

```typescript
// 连接系统 ServiceExtensionAbility
const connectionId = featureAbility.connectAbility({
  bundleName: 'com.os.photos',
  abilityName: 'PhotoServiceExtension',
}, {
  onConnect: (element, proxy) => { /* 获取服务代理 */ },
  onDisconnect: (element) => { /* 连接断开处理 */ },
});
```

### 数据查询方式

```typescript
// 条件查询：通过 FetchOptions 定义筛选条件
const fetchOptions: photoAccessHelper.FetchOptions = {
  fetchColumns: ['uri', 'name', 'size', 'date_modified'],
  predicates: new dataSharePredicates.DataSharePredicates()
    .equalTo('album_id', albumId)
    .orderByDesc('date_modified'),
};

// 批量查询：getAssets 返回 FetchResult，支持分页
const fetchResult = await helper.getAssets(fetchOptions);
const totalCount = fetchResult.getCount();

// 分页加载：结合 DataSource 的 reloadData/loadMore
async function loadMore(startIndex: number, count: number): Promise<MediaItem[]> {
  return await fetchResult.getAssetsWithCount(startIndex, count);
}
```

---

### 

### 三种索引类型

| type 值     | 含义                              | 关键字段                        |
|-------------|-----------------------------------|--------------------------------|
| Model       | @Observed 响应式数据模型          | decorator, fields[].track      |
| DataSource  | IDataSource 实现类                | dataType, features             |
| DataType    | enum 或 interface 纯数据定义      | values / properties            |

---

## 7. 数据架构理解检查清单

- [ ] 识别 @Observed 数据模型与 @Track 字段
- [ ] 识别 interface 纯数据结构与 enum 枚举
- [ ] 定位 IDataSource 实现类及其数据加载方式
- [ ] 分析 DataSourceManager 数据源管理策略
- [ ] 追踪 belongsTo / hasMany / hasOne 关系（通过引用字段）
- [ ] 确定数据持久化方式（AppStorage / LocalStorage / Preferences / RDB）
- [ ] 识别 Helper 类封装的系统 API（PhotoAccessHelper 等）
- [ ] 分析分页加载与 LazyForEach 数据消费模式
- [ ] 对照 data-models.map.json 验证模型索引完整性
- [ ] 检查数据加载状态机（WAIT_TO_LOAD / LOADING / IDLE）