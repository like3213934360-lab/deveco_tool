## 10. 对话框与半模态约束

| 规则 | 说明 |
|------|------|
| 多弹窗堆叠 | 多个弹窗按**后弹优先**原则堆叠，退出时从高到低 |
| 系统弹窗阻塞自定义弹窗 | 系统弹窗显示时，**非系统弹窗显示接口被阻塞**（如 promptAction.openCustomDialog、CustomDialogController.open） |
| 不建议后台弹窗 | 应用**不在前台时**不建议调用弹窗显示接口 |
| bindSheet onWillDismiss | 声明后**所有关闭操作**（滑动、关闭按钮、遮罩点击、下拉）必须通过 `dismiss()` 调用处理，否则**无法关闭** |
| bindSheet UIExtension 限制 | Sheet 内嵌入 UIExtension 时，**不支持**在 UIExtension 内再启动额外的 sheet/dialog |
| bindSheet 悬停避让限制 | 悬停/中轴避让**不支持**子窗口模式（showInSubWindow 为 true 时） |
| CustomDialogController | 从 API version 12 开始**不推荐使用**，建议使用 promptAction.openCustomDialog |
| AlertDialog buttons 字段 | buttons 元素类型 `AlertDialogButtonOptions`，必需字段 **`value`(ResourceStr) + `action`(VoidCallback)**，可选 `fontColor`/`backgroundColor`/`style`。**没有 `text` 字段**，用 `text` 报 **10505001**（'text' does not exist in type 'AlertDialogButtonOptions'） |
| bindSheet height 取值 | `SheetSize` enum 只有 **`MEDIUM`(半屏)/`LARGE`(近全屏)**，**没有 `HALF`**。用 `SheetSize.HALF` 报 **10505001**（Property 'HALF' does not exist on type 'typeof SheetSize'） |

---

### AlertDialog.show 最小模板

AlertDialog.show 的 buttons 字段是 `value`（不是 `text`）+ `action`，二者必需。

```typescript
Button('删除').onClick(() => {
  this.getUIContext().showAlertDialog({
    message: '确认删除？',
    buttons: [
      { value: '取消', action: () => { /* 取消 */ } },
      { value: '确认', action: () => { /* 确认 */ } }   // ✅ value + action
    ]
  })
})
// ❌ buttons: [{ text: '取消' }]  -- 没有 text 字段，报 10505001
```

> **注意**：部分示例 prompt 写 `buttons: [{ text: ... }]` 是错误示范，必须改用 `value`。多按钮也可用 `primaryButton`/`secondaryButton`（同样用 `value`）。

### bindSheet 最小模板

bindSheet 的 height 用 `SheetSize.MEDIUM`（半屏）或 `SheetSize.LARGE`（近全屏），**无 HALF**。

```typescript
@Entry
@Component
struct SheetDemo {
  @State isShow: boolean = false
  @Builder sheetBuilder() { Column() { Text('sheet 内容') } }

  build() {
    Column() {
      Button('打开 sheet').onClick(() => { this.isShow = true })
        .bindSheet($$this.isShow, this.sheetBuilder, {
          height: SheetSize.MEDIUM,   // ✅ MEDIUM(半屏)/LARGE(近全屏)，无 HALF
          dragBar: true,
          showClose: true
        })
    }
  }
}
```
