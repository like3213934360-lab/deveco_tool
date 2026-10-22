import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

async function getAvoidArea(context: common.UIAbilityContext): Promise<window.AvoidArea> {
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
}

async function setImmersiveWindow(context: common.UIAbilityContext): Promise<void> {
  const currentWindow = await window.getLastWindow(context);
  await currentWindow.setWindowLayoutFullScreen(true);
}

async function getTitleButtonRect(context: common.UIAbilityContext): Promise<window.TitleButtonRect> {
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getTitleButtonRect();
}

@Entry
@Component
struct StandaloneFunctionError {
  @State avoidAreaHeight: number = 0;
  @State isImmersive: boolean = false;
  @State titleBarHeight: number = 0;

  async aboutToAppear() {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      console.error('UIAbility context is unavailable');
      return;
    }
    const context = host as common.UIAbilityContext;
    
    try {
      const avoidArea = await getAvoidArea(context);
      this.avoidAreaHeight = avoidArea.topRect.height;
    } catch (err) {
      console.error('获取避让区域失败:', err instanceof Error ? err.message : String(err));
    }
    
    try {
      await setImmersiveWindow(context);
      this.isImmersive = true;
    } catch (err) {
      console.error('设置沉浸式窗口失败:', err instanceof Error ? err.message : String(err));
    }
    
    try {
      const titleButtonRect = await getTitleButtonRect(context);
      this.titleBarHeight = titleButtonRect.height;
    } catch (err) {
      console.error('获取标题栏按钮区域失败:', err instanceof Error ? err.message : String(err));
    }
  }

  build() {
    Column() {
      Text(`避让区域高度: ${this.avoidAreaHeight}`)
      Text(`沉浸式状态: ${this.isImmersive}`)
      Text(`标题栏高度: ${this.titleBarHeight}`)
    }
  }
}
