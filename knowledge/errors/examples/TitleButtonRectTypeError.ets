import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

async function getTitleButtonRect(context: common.UIAbilityContext): Promise<window.TitleButtonRect> {
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getTitleButtonRect();
}

@Entry
@Component
struct TitleButtonRectTypeError {
  @State titleBarHeight: number = 0;
  @State titleBarWidth: number = 0;

  async aboutToAppear() {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      console.error('UIAbility context is unavailable');
      return;
    }
    const context = host as common.UIAbilityContext;
    try {
      const titleButtonRect = await getTitleButtonRect(context);
      // 使用 SDK 声明的 TitleButtonRect 尺寸
      this.titleBarHeight = titleButtonRect.height;
      this.titleBarWidth = titleButtonRect.width;
    } catch (err) {
      console.error('获取标题栏按钮区域失败:', err instanceof Error ? err.message : String(err));
    }
  }

  build() {
    Column() {
      Text('TitleButtonRect 类型错误示例')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 20 })
      
      Text(`标题栏高度: ${this.titleBarHeight}`)
        .margin({ bottom: 8 })
      Text(`标题栏宽度: ${this.titleBarWidth}`)
    }
    .padding(20)
  }
}
