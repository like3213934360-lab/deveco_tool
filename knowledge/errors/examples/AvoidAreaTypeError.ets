import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct AvoidAreaTypeError {
  @State value: string = '';
  private currentWindow?: window.Window;
  private generation: number = 0;
  private changed = (data: window.AvoidAreaOptions): void => {
    if (data.type === window.AvoidAreaType.TYPE_SYSTEM) {
      this.value = `顶部: ${data.area.topRect.height}, 底部: ${data.area.bottomRect.height}`;
    }
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
      const area = currentWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      this.value = `顶部: ${area.topRect.height}, 底部: ${area.bottomRect.height}`;
      currentWindow.on('avoidAreaChange', this.changed);
      this.currentWindow = currentWindow;
    } catch (error) {
      if (generation === this.generation) { this.value = `窗口读取失败: ${String(error)}`; }
    }
  }
  aboutToDisappear(): void {
    this.generation++;
    this.currentWindow?.off('avoidAreaChange', this.changed);
    this.currentWindow = undefined;
  }
  build() {
    Column() { Text(this.value) }
  }
}
