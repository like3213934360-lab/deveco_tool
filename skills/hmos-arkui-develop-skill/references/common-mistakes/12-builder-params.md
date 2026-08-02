## 12. @Builder 参数传递错误

AI 经常写出 @Builder 参数传递方式不当的代码，导致 **UI 不刷新**或**参数不对等**。@Builder 有三种参数传递方式，选错方式是最高频根因。

### 传递方式速查

| 传递方式 | 调用形式 | 状态变量变化是否刷新 | 适用场景 |
|---------|---------|-------------------|---------|
| 按值传递（默认） | `builder(this.label)` 或 `builder(label: string)` | ❌ 不刷新 | 参数不依赖状态变量，或仅初始渲染一次 |
| 按引用传递 | `builder({ paramA1: this.label })` 单参数对象字面量 | ✅ 刷新 | 参数为状态变量，需随变化刷新 |
| 按回调传递（API 20+） | `builder(UIUtils.makeBinding(() => this.x, setter))` | ✅ 刷新且可在 Builder 内修改 | 需在 Builder 内修改入参并回传调用方 |

### 错误 1：按值传递状态变量，UI 不刷新

❌ 错误用法
```typescript
@Builder
function overBuilderByValue(paramA1: string) {  // 简单类型 = 按值传递
  Text(`UseStateVarByValue: ${paramA1}`)
}

@Entry
@Component
struct ParameterValue {
  @State label: string = 'Hello';
  build() {
    Column() {
      overBuilderByValue(this.label)  // ❌ label 变化时 Builder 内 Text 不刷新
      Button('change').onClick(() => { this.label = 'ArkUI'; })
    }
  }
}
```

✅ 正确用法（改为按引用传递：单参数 + 对象字面量）
```typescript
class Tmp { paramA1: string = '' }

@Builder
function overBuilderByReference(params: Tmp) {  // 对象类型 + 单参数
  Text(`UseStateVarByReference: ${params.paramA1}`)
}

@Entry
@Component
struct ParameterReference {
  @State label: string = 'Hello';
  build() {
    Column() {
      overBuilderByReference({ paramA1: this.label })  // ✅ label 变化时刷新
      Button('change').onClick(() => { this.label = 'ArkUI'; })
    }
  }
}
```

> **根因**：按值传递时 @Builder 接收的是状态变量值的拷贝，未建立依赖关系，状态变化不触发 Builder 重渲染。

### 错误 2：两个或以上参数，即使对象字面量也不刷新

❌ 错误用法
```typescript
class GlobalTmp { strValue: string = 'Hello' }
class SecondTmp { numValue: number = 0 }

@Builder
function overBuilder(param: GlobalTmp, num: SecondTmp) {  // 两个参数
  Text(`strValue: ${param.strValue}`)
  Text(`num: ${num.numValue}`)
}
// 调用：overBuilder({ strValue: this.strParam.strValue }, { numValue: this.numParam.numValue })  // ❌ 不刷新
```

✅ 正确用法（合并为单个对象参数）
```typescript
class GlobalTmp {
  strValue: string = 'Hello';
  numValue: number = 0;
}

@Builder
function overBuilder(param: GlobalTmp) {  // 单个参数
  Text(`strValue: ${param.strValue}`)
  Text(`num: ${param.numValue}`)
}
// 调用：overBuilder({ strValue: this.objParam.strValue, numValue: this.objParam.numValue })  // ✅ 刷新
```

> **根因**：按引用传递只在**传入一个参数且为对象字面量**时才触发动态渲染；多参数、或按值与按引用混用，均不刷新。

### 错误 3：@Builder 内创建自定义组件，传整个对象不刷新

❌ 错误用法
```typescript
class Tmp { name: string = ''; age: number = 0 }

@Builder
function parentBuilder(params: Tmp) {
  Column() {
    Text(`parent===${params.name}===${params.age}`)
    HelloComponent({ info: params })  // ❌ 传整个对象，name/age 变化时子组件不刷新
  }
}

@Component
struct HelloComponent {
  @Prop info: Tmp = new Tmp();
  build() { Text(`child===${this.info.name}===${this.info.age}`) }
}
```

✅ 正确用法（拆成简单类型属性传入子组件）
```typescript
@Builder
function parentBuilder(params: Tmp) {
  Column() {
    Text(`parent===${params.name}===${params.age}`)
    HelloComponent({ childName: params.name, childAge: params.age })  // ✅ 拆成简单类型，刷新
  }
}

@Component
struct HelloComponent {
  @Prop childName: string = '';
  @Prop childAge: number = 0;
  build() { Text(`child===${this.childName}===${this.childAge}`) }
}
```

> **根因**：@Builder 内创建自定义组件时，把整个对象作为参数传入不属于按引用传递，子组件的 @Prop/@Link 接收不到变化。拆成简单类型属性后，每个属性独立传递可正常刷新。

### 错误 4：@Builder 内修改入参，不刷新且报 140109

❌ 错误用法
```typescript
@Builder
function myGlobalBuilder(value: string) {
  Text(`value: ${value}`)
    .onClick(() => {
      value = 'change';  // ❌ 简单类型按值传递，修改不刷新
    })
}

interface TempMod { paramA: string }

@Builder
function overBuilder(param: TempMod) {
  Button(`${param.paramA}`)
    .onClick(() => {
      param.paramA = 'Yes';  // ❌ 对象类型按引用传递，改属性运行时报错（API23 起报 140109）
    })
}
```

✅ 正确用法一（在调用方组件的事件回调中修改状态变量，不在 Builder 内改入参）
```typescript
@Builder
function overBuilder(param: TempMod) {
  Button(`${param.paramA}`)  // 不在 Builder 内修改，依赖按引用传递刷新
}
// 调用方：
// overBuilder({ paramA: this.label })
// Button('change').onClick(() => { this.label = 'ArkUI'; })
```

✅ 正确用法二（用 MutableBinding 在 Builder 内修改并回传，API 20+）
```typescript
import { UIUtils, MutableBinding } from '@kit.ArkUI';

@Builder
function myGlobalBuilder(str: MutableBinding<string>) {
  Text(`value: ${str.value}`)
    .onClick(() => {
      str.value = 'change';  // ✅ 修改回传到调用方
    })
}
// 调用：
myGlobalBuilder(UIUtils.makeBinding<string>(
  () => this.message,
  (val: string) => { this.message = val; }  // 必须传 SetterCallback，否则运行时报错
))
```

> **根因**：@Builder 内不允许修改参数值/属性。简单类型修改不生效（静默不刷新）；对象类型修改属性会抛运行时错误，API 23 起返回错误码 140109。需在 Builder 内修改时必须用 MutableBinding 并传 SetterCallback。

### 错误 5：@Builder 方法赋值给变量/数组后刷新异常

❌ 错误用法
```typescript
@Builder myImages() { Column() { Image($r('app.media.startIcon')) } }
@Builder myImages2() { Column() { Image($r('app.media.startIcon')) } }

private bgList: Array<CustomBuilder> = [this.myImages(), this.myImages2()];  // ❌ UI 语句外调用
@State bgBuilder: CustomBuilder = this.myImages();  // ❌ 赋值给变量后刷新异常
```

✅ 正确用法（直接调用或传方法引用）
```typescript
Text('2').background(this.myImages)    // ✅ 传方法引用
Text('3').background(this.myImages())  // ✅ 直接调用
```

> **根因**：@Builder 方法赋值给变量或数组后，在 UI 方法中无法正常使用，刷新时节点显示异常。应直接调用或作为方法引用传入。

### 错误 6：@Watch 回调内调用 @Builder 导致刷新异常

❌ 错误用法
```typescript
@Provide @Watch('provideWatch') content: string = 'hello';

@Builder watchBuilder(content: string) { Row() { Text(`${content}`) } }

provideWatch() {
  this.watchBuilder(this.content);  // ❌ @Watch 内调用 @Builder 导致 UI 异常
}
```

✅ 正确用法（@Watch 只做逻辑，@Builder 在 build 中调用）
```typescript
provideWatch() {
  console.info('content changed');  // ✅ 只做逻辑处理
}

build() {
  Column() {
    this.watchBuilder(this.content);  // ✅ 在 build 中调用
  }
}
```

**根因总结**：AI 把 @Builder 当成普通函数，不了解其三种参数传递方式的刷新差异和限制。关键规则：**状态变量要刷新 → 单参数对象字面量按引用传递；不在 Builder 内改入参；不在 UI 语句外调用 Builder 方法；不在 @Watch 内调用 Builder**。完整规则见 `quick-rules/03-state-v1.md` 第 3 节 @Builder 条目。

### 错误 7：wrapBuilder / WrappedBuilder 泛型漏 tuple 括号

跨组件传递全局 @Builder 时用 `wrapBuilder`，泛型**必须是 tuple 数组类型 `[T]`**，漏写 `[]` 报 **10505001**。

❌ 错误用法
```typescript
interface CardData { text: string }
@Builder
function CardBuilder($$: CardData) { Text($$.text) }

const wrapper: WrappedBuilder<CardData> = wrapBuilder(CardBuilder)  // ❌ 泛型漏 []，CardData 不满足 Object[] 约束
// 报错：Type 'CardData' does not satisfy the constraint 'Object[]'
// 调用 wrapper.builder({text:item}) 也会类型不匹配：Argument of type '[{ text: string; }]' is not assignable to parameter of type 'CardData'
```

✅ 正确用法（泛型写成 tuple `[CardData]`）
```typescript
interface CardData { text: string }

@Builder
function CardBuilder($$: CardData) { Text($$.text) }

const wrapper: WrappedBuilder<[CardData]> = wrapBuilder(CardBuilder)  // ✅ tuple 泛型

@Entry
@Component
struct CardListPage {
  private items: string[] = ['A', 'B', 'C']
  build() {
    Column({ space: 12 }) {
      ForEach(this.items, (item: string) => {
        wrapper.builder({ text: item })   // ✅ 调用 builder 方法，传第一个 arg
      }, (item: string) => item)
    }
  }
}
```

> **根因**：SDK 定义 `declare class WrappedBuilder<Args extends Object[]>` 与 `declare function wrapBuilder<Args extends Object[]>(...)`，泛型约束是数组（tuple）。AI 习惯写 `WrappedBuilder<T>` 漏掉 `[]`。正确写法是 `WrappedBuilder<[T]>`，调用方式为 `wrapper.builder(arg)`（builder 方法签名 `(...args: Args) => void`）。
