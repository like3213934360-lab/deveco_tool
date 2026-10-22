## 13. 渲染控制

| 语法 | 签名 | 说明 |
|------|------|------|
| **if/else** | `if (condition) {} else if {} else {}` | 条件渲染 |
| **ForEach** | `ForEach(arr, (item, index?) => void, keyGen?)` | 迭代渲染 |
| **LazyForEach** | `LazyForEach(dataSource, (item, index?) => void, keyGen?)` | 懒加载迭代 |
| **Repeat** | `Repeat\<T\>(arr)` | API 12+ V2 版渲染控制 |

**Repeat 方法链：**

| 方法 | 签名 | 说明 |
|------|------|------|
| .each | `.each((ri: RepeatItem\<T\>) => void)` | 渲染每项 |
| .key | `.key((item, index) => string)` | 生成 key |
| .virtualScroll | `.virtualScroll(options?)` | 虚拟滚动 |
| .template | `.template(name, itemGen, options?)` | 模板化 |

总条目数放入 `.virtualScroll({ totalCount })`；模板缓存数放入 `.template(name, itemBuilder, { cachedCount })`。滚动容器另有 `.cachedCount()`。这些不是 Repeat 的三个独立链式方法。
