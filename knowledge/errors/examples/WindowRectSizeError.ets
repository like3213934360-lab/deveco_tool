import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct WindowRectSizeError {
  @State value: string = '';
  private currentWindow?: window.Window;
  private generation: number = 0;
  private changed = (data: window.Size): void => {
    this.value = `${data.width} × ${data.height}`;
  };
  async aboutToAppear(): Promise<void> {
    const generation = ++this.generation;
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      this.value = 'Context is unavailable';
      return;
    }
    try {
      const currentWindow = await window.getLastWindow(host as common.UIAbilityContext);
      if (generation !== this.generation) { return; }
      const rect = currentWindow.getWindowProperties().windowRect;
      this.value = `${rect.width} × ${rect.height}`;
      currentWindow.on('windowSizeChange', this.changed);
      this.currentWindow = currentWindow;
    } catch (error) {
      if (generation === this.generation) { this.value = `窗口读取失败: ${String(error)}`; }
    }
  }
  aboutToDisappear(): void {
    this.generation++;
    this.currentWindow?.off('windowSizeChange', this.changed);
    this.currentWindow = undefined;
  }
  build() {
    Column() { Text(this.value) }
  }
}
