## 13. @Observed / @ObjectLink 不刷新问题

AI 经常写出 @Observed/@ObjectLink 用法不当的代码，导致嵌套对象属性变化后 **UI 不刷新**。@Observed 的所有"不刷新"本质上都源于一个机制：**@State/@ObjectLink 只对对象的第一层建立代理，嵌套对象内层属性的变化必须让内层类也被 @Observed 装饰，并通过子组件 @ObjectLink 建立依赖才能被观察到**。

### 场景 1：嵌套对象第二层属性不刷新（最高频）

@State 只能观察到第一层赋值，`this.cousin.child.childId` 是第二层，改了不刷新。

❌ 错误用法
```typescript
class Child { childId: number; constructor(id: number) { this.childId = id } }

class Cousin {
  child: Child;
  constructor(childId: number) { this.child = new Child(childId) }
}

@Entry
@Component
struct MyView {
  @State cousin: Cousin = new Cousin(30);
  build() {
    Column() {
      Text(`childId: ${this.cousin.child.childId}`)  // ❌ 点击后不刷新
      Button('change').onClick(() => { this.cousin.child.childId += 1; })
    }
  }
}
```

✅ 正确用法（内层类加 @Observed + 子组件 @ObjectLink 接收）
```typescript
@Observed
class Child { childId: number; constructor(id: number) { this.childId = id } }

class Cousin { child: Child; constructor(childId: number) { this.child = new Child(childId) } }

@Component
struct ViewChild {
  @ObjectLink child: Child;   // 接收 @Observed 装饰的 Child 实例
  build() {
    Text(`childId: ${this.child.childId}`)  // ✅ childId 变化刷新
      .onClick(() => { this.child.childId += 1; })
  }
}

@Entry
@Component
struct MyView {
  @State cousin: Cousin = new Cousin(30);
  build() {
    Column() {
      ViewChild({ child: this.cousin.child })  // ✅ 用子组件渲染内层对象
    }
  }
}
```

> **根因**：@State cousin 只代理 Cousin 的第一层属性（parentId/cousinId/child 的整体替换），`child.childId` 属于 Child 的属性，@State 观察不到。Child 被 @Observed 装饰后，其属性变化能被 @ObjectLink 观察到。

### 场景 2：@ObjectLink 整体赋值报错

@ObjectLink 装饰的变量是只读的，整体赋值会运行报错 `Cannot set property when setter is undefined`。

❌ 错误用法
```typescript
@Observed
class Info { count: number; constructor(c: number) { this.count = c } }

@Component
struct Child {
  @ObjectLink num: Info;
  build() {
    Text(`${this.num.count}`)
      .onClick(() => { this.num = new Info(10); })  // ❌ 运行时报错
  }
}
```

✅ 正确用法（子组件改属性；需要整体替换时在父组件做）
```typescript
@Component
struct Child {
  @ObjectLink num: Info;
  build() {
    Text(`${this.num.count}`)
      .onClick(() => { this.num.count = 20; })  // ✅ 改属性，刷新
  }
}

@Entry
@Component
struct Parent {
  @State num: Info = new Info(10);
  build() {
    Column() {
      Child({ num: this.num })
      Button('reset').onClick(() => { this.num = new Info(30); })  // ✅ 父组件整体替换
    }
  }
}
```

> **根因**：@ObjectLink 是指向数据源的引用指针，整体赋值会打断同步链。改属性走代理 setter 触发刷新；整体替换只能在父组件对 @State 数据源做。

### 场景 3：两层以上嵌套，单层 @ObjectLink 观察不到更内层

@ObjectLink value: ParentCounter 只代理 ParentCounter 第一层，`value.subCounter.counter` 是 SubCounter 的属性，观察不到。

❌ 错误用法
```typescript
@Observed class SubCounter { counter: number; constructor(c: number) { this.counter = c } }
@Observed class ParentCounter { subCounter: SubCounter; constructor(c: number) { this.subCounter = new SubCounter(c) } }

@Component
struct CounterComp {
  @ObjectLink value: ParentCounter;
  build() {
    Text(`${this.value.subCounter.counter}`)  // ❌ setSubCounter 改 counter 不刷新
      .onClick(() => { this.value.subCounter.counter = 10; })
  }
}
```

✅ 正确用法（为内层再拆一个子组件 @ObjectLink）
```typescript
@Component
struct CounterComp {
  @ObjectLink value: ParentCounter;
  build() {
    Column() {
      Text(`${this.value.counter}`)
      CounterChild({ subValue: this.value.subCounter })  // ✅ 内层单独传 @ObjectLink
    }
  }
}

@Component
struct CounterChild {
  @ObjectLink subValue: SubCounter;   // 代理 SubCounter 第一层
  build() {
    Text(`${this.subValue.counter}`)  // ✅ 改 counter 刷新
      .onClick(() => { this.subValue.counter += 1; })
  }
}
```

> **根因**：@ObjectLink 只代理它直接接收的那个类的属性。要观察 N 层嵌套，需要 N 个 @Observed 类 + N 层子组件 @ObjectLink，每层各代理一层属性。

### 场景 4：@Observed 类构造函数中修改成员变量不刷新

构造函数执行时实例尚未被代理封装，`this` 指向原始对象，修改不经过代理，无法被观察。

❌ 错误用法
```typescript
@Observed
class DataDownloader {
  state: number;
  constructor() {
    this.state = 0;
    setInterval(() => { this.state += 1; }, 2000);  // ❌ 构造函数内改，UI 不刷新
  }
}

@Entry @Component
struct Index {
  @State dataDownloader: DataDownloader = new DataDownloader();
  build() { Text(`state: ${this.dataDownloader.state}`) }
}
```

✅ 正确用法（构造函数只初始化，定时器移到组件生命周期）
```typescript
@Observed
class DataDownloader {
  state: number;
  constructor() { this.state = 0; }   // 只初始化
  startUpdate() { setInterval(() => { this.state += 1; }, 2000); }  // 普通方法内改
}

@Entry @Component
struct Index {
  @State dataDownloader: DataDownloader = new DataDownloader();
  aboutToAppear() { this.dataDownloader.startUpdate(); }  // ✅ 代理已建立，修改可观察
  build() { Text(`state: ${this.dataDownloader.state}`) }
}
```

> **根因**：@Observed 在 `new` 创建实例后才包装代理。构造函数内的 `this` 是未代理的原始对象，赋值直接改数据源、不触发通知。必须等实例被状态变量接收（代理建立）后再修改。同理：构造函数里捕获 `this` 的箭头函数回调也不刷新，要把回调赋值挪到普通方法中。

### 场景 5：LazyForEach + @ObjectLink 联用，替换数组项后不刷新

> ⚠️ **归类说明**：本场景本质是 **LazyForEach 绑定机制 + @ObjectLink 联用**的复合问题，不纯粹是 @Observed 观察边界问题。直接改 dataSource 内部数组不刷新是 LazyForEach 机制导致（与 @Observed 无关）；@Observed 只在"通知后新实例能否响应后续属性变化"这一层起作用。

❌ 错误用法（直接改 dataSource 内部数组，LazyForEach 不知道）
```typescript
@Observed
class StringData { message: string; constructor(m: string) { this.message = m } }

Button('替换第一个元素').onClick(() => {
  this.data.dataArray[0] = new StringData('Hello 4');  // ❌ LazyForEach 未被通知，不刷新
})
Button('修改第一个元素').onClick(() => {
  this.data.dataArray[0].message += '1';  // ❌ 新实例未绑定到子组件 @ObjectLink，仍不刷新
})
```

✅ 正确用法（替换后通过 DataSource 的 notify 方法触发 DataChangeListener.onDataChange）
```typescript
Button('替换第一个元素').onClick(() => {
  this.data.dataArray[0] = new StringData('Hello 4');
  this.data.notifyDataChanged(0);   // ✅ 通知 LazyForEach 重新绑定 index 0
})
Button('修改第一个元素').onClick(() => {
  this.data.dataArray[0].message += '1';  // ✅ 新实例已通过 @ObjectLink 建立依赖，@Observed 代理拦截变化，刷新
})
```

> **根因（分两层）**：
> ① LazyForEach 不监听 dataSource 内部数组变化，必须由 DataSource 主动调用 notify 方法（如 `notifyDataChanged`）触发 `DataChangeListener.onDataChange`，否则不刷新——这是 LazyForEach 绑定机制，与 @Observed 无关；
> ② 通知后新实例能否在子组件响应后续属性变化，才依赖 StringData 被 @Observed 装饰 + 子组件 @ObjectLink 建立依赖。
>
> 注意区分 `onDataChange`（DataChangeListener 接口方法）与 `notifyDataChanged`（DataSource 自定义封装方法，内部遍历 listeners 调 `listener.onDataChange`），开发者调用的是后者。LazyForEach 的 key 也需随数据变化而变化（如 `index + item.message`），否则即使通知也可能不触发重建。

### 场景 6：@ObjectLink 接收未 @Observed 装饰的类，不刷新

@ObjectLink 接收的类实例若未被 @Observed 装饰（API 19 前），属性变化无法观察，运行时会有告警日志。

❌ 错误用法
```typescript
class Inner { value: string = 'inner'; }   // ❌ 未加 @Observed

@Component
struct Child {
  @ObjectLink inner: Inner;   // 运行时告警：assigned value is not be decorated by @Observed
  build() {
    Text(`${this.inner.value}`)
      .onClick(() => { this.inner.value += '!'; })  // ❌ 不刷新，@Watch 也不触发
  }
}
```

✅ 正确用法（内层类加 @Observed）
```typescript
@Observed
class Inner { value: string = 'inner'; }   // ✅ 加 @Observed

@Component
struct Child {
  @ObjectLink inner: Inner;
  build() {
    Text(`${this.inner.value}`)              // ✅ 刷新
      .onClick(() => { this.inner.value += '!'; })
  }
}
```

> **根因**：@ObjectLink 的观察能力依赖被观察类被 @Observed 装饰（API 19+ 可用 makeV1Observed 替代）。未装饰时属性变化无代理拦截，框架会打印 `FIX THIS APPLICATION ERROR` 告警。可用 `UIUtils.getTarget(obj) === obj` 判断对象是否已被代理（返回 false 表示已代理、可观察）。

### 场景 7：嵌套数组属性 push/splice 增删项不刷新

@State 装饰的对象，其数组属性（如 `project.milestones`、`milestone.tasks`）做 `push` 增删项时，既非第一层属性赋值（数组引用未变）、也非元素属性修改，@State 观测不到。即使数组类型用了 `@Observed class extends Array`，若没有子组件用 `@ObjectLink` 接收该数组实例本身，push 仍不可观测。

❌ 错误用法（@State 对象的数组属性 push，不刷新）
```typescript
@Observed
class Task { id: number; done: boolean; constructor(id: number) { this.id = id; this.done = false } }

@Observed
class Project {
  tasks: Task[] = [];   // ❌ 普通数组属性
}

@Entry @Component
struct Page {
  @State project: Project = new Project();
  build() {
    Column() {
      ForEach(this.project.tasks, (t: Task) => Text(`${t.id}`), (t: Task) => t.id.toString())
      Button('add').onClick(() => {
        this.project.tasks.push(new Task(1));  // ❌ project 第一层未变，push 不刷新
      })
    }
  }
}
```

✅ 正确用法（ObservedArray + 子组件 @ObjectLink 接收数组实例本身，二者缺一不可）
```typescript
@Observed
class Task { id: number; done: boolean; constructor(id: number) { this.id = id; this.done = false } }

@Observed
class ObservedArray<T> extends Array<T> {}   // ✅ 可观察数组

@Observed
class Project {
  tasks: ObservedArray<Task> = new ObservedArray<Task>();
}

// ✅ 子组件 @ObjectLink 接收数组本身（@Entry 不能 @ObjectLink，故须抽子组件）
@Component
struct TaskListView {
  @ObjectLink tasks: ObservedArray<Task>;
  build() {
    ForEach(this.tasks, (t: Task) => Text(`${t.id}`), (t: Task) => t.id.toString())
  }
}

@Entry @Component
struct Page {
  @State project: Project = new Project();
  build() {
    Column() {
      TaskListView({ tasks: this.project.tasks })   // ✅ @ObjectLink 接收数组，push 局部刷新
      Button('add').onClick(() => {
        this.project.tasks.push(new Task(1));  // ✅ 观测到，ForEach 局部刷新
      })
    }
  }
}
```

> **根因**：@State project 只代理 project 第一层（tasks 的整体替换），`project.tasks.push()` 改的是数组内部、tasks 引用未变，第一层观测不到。让 push 可观测须同时满足：① 数组类型为 `@Observed class extends Array`（数组增删 API 被代理）；② 有子组件 `@ObjectLink` 接收该数组实例本身建立依赖。缺任一条件 push 都不刷新。
>
> **多层嵌套**：树形数据（Project -> Milestone -> Task）每层数组属性都要 ObservedArray + 对应 @ObjectLink 子组件逐层桥接。

### 场景 8：聚合值（已完成数/总进度）不刷新

父组件显示基于子项属性计算的聚合值（如"已完成 2/5"），子项 `done` 变化后父组件的聚合数字不更新。@State/@ObjectLink 观测不到深层属性变化，聚合值不会自动重算。

❌ 错误用法（聚合值直接绑定计算表达式，子项属性变化不刷新）
```typescript
@Entry @Component
struct Page {
  @State project: Project = new Project();   // Project.tasks: ObservedArray<Task>
  build() {
    Column() {
      // ❌ 即使 tasks[i].done 通过子组件 @ObjectLink 改了，这里重算的聚合值不刷新
      Text(`已完成 ${this.project.tasks.filter((t: Task) => t.done).length}/${this.project.tasks.length}`)
      TaskListView({ tasks: this.project.tasks })
    }
  }
}
```

✅ 正确用法（用 @State 缓存聚合值，子项变化时通过回调手动 recompute）
```typescript
@Component
struct TaskListView {
  @ObjectLink tasks: ObservedArray<Task>;
  onTasksChange: () => void = () => {};   // 回调通知父组件重算
  build() {
    ForEach(this.tasks, (t: Task) => {
      TaskItem({ task: t, onToggle: (): void => { this.onTasksChange(); } })
    }, (t: Task) => t.id.toString())
  }
}

@Entry @Component
struct Page {
  @State project: Project = new Project();
  @State doneCount: number = 0;   // ✅ @State 缓存聚合值
  private recompute() {
    this.doneCount = this.project.tasks.filter((t: Task) => t.done).length;
  }
  aboutToAppear() { this.recompute(); }
  build() {
    Column() {
      Text(`已完成 ${this.doneCount}/${this.project.tasks.length}`)   // ✅ doneCount 是 @State，刷新
      TaskListView({ tasks: this.project.tasks, onTasksChange: (): void => { this.recompute(); } })
    }
  }
}
```

> **根因**：@State project 只代理第一层，`tasks[i].done` 的深层属性变化父组件观测不到；即使子组件 @ObjectLink 改了 done 并刷新了自身，父组件里基于 `tasks.filter(...)` 重算的表达式不会被重新求值。须把聚合值存为 @State，子项变化时通过回调（onToggle -> onTasksChange -> recompute）手动重算。V2 的 @ObservedV2/@Trace 可让深层属性变化被自动观测，从而省去手动回调。

### 其他高频场景

| 场景 | 错误 | 正确 |
|------|------|------|
| **ForEach 对象数组替换项** | `this.infos[0] = new Info()` 后 key 未变，Child 不重建，@ObjectLink 仍指向旧实例，改属性不刷新 | key 包含会变化的字段，让 ForEach 识别为变化项触发 Child 重建 |
| **数据重置用普通数组** | `this.childList = [new Child(1), ...]`（普通 Child[] 赋值给 @Observed 类变量），新数组不可观测 | `let temp = new ChildList()`（@Observed 继承 Array 的类）再赋值，或用 `makeV1Observed` |
| **同步回调内改状态变量** | 在 `onComplete` 等同步渲染回调中直接赋值，触发 "state changed during render" 导致本次刷新被忽略 | 用 `setTimeout` 将赋值转为异步 |

### 排查思路（五步法，来自 `troubleshooting-state-manage.md`）

遇到 @Observed 不刷新时按顺序排查：

1. **依赖是否收集**：状态变量是否在 build 中被读取（ArkUI Inspector 查依赖）
2. **值是否真变化**：打印赋值前后值
3. **赋值是否可观察**：用 `UIUtils.getTarget(obj) === obj` 判断对象是否被代理（false = 已代理可观察）；@ObservedV2 场景检查属性是否 @Trace
4. **数据源与同步对象是否关联**：ForEach/LazyForEach 替换项后是否断链（用 `util.getHash` 比较引用）
5. **组件更新函数是否执行**：是否在渲染回调中改了状态导致本次刷新被忽略

**根因总结**：@Observed 不刷新的核心是"观察边界"——第一层由 @State/@ObjectLink 代理，**每多一层嵌套就要多一个 @Observed + @ObjectLink 子组件**；另外构造函数内修改、LazyForEach 替换未通知、@ObjectLink 整体赋值、嵌套数组属性增删项（场景7）、聚合值未手动维护（场景8）是五个非观察边界的高频陷阱。完整规则见 `quick-rules/03-state-v1.md` 第 3 节 @Observed/@ObjectLink 条目。
