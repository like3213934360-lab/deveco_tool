import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

interface WindowSize {
  width: number;
  height: number;
}
@Entry
@Component
struct ObjectLiteralTypeError {
  @State windowSize: WindowSize = { width: 0, height: 0 };
  async aboutToAppear(): Promise<void> {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      console.error('Context is unavailable');
      return;
    }
    try {
      const currentWindow = await window.getLastWindow(host as common.UIAbilityContext);
      const rect = currentWindow.getWindowProperties().windowRect;
      this.windowSize = { width: rect.width, height: rect.height };
    } catch (error) {
      console.error(`Window size failed: ${String(error)}`);
    }
  }
  build() {
    Column() {
      Text(`宽度: ${this.windowSize.width}`)
      Text(`高度: ${this.windowSize.height}`)
    }
  }
}
