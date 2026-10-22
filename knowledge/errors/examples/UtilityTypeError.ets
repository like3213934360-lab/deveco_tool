export class Debouncer {
  private timer: number = -1;
  schedule(action: () => void, delayMs: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = -1;
      action();
    }, delayMs);
  }
  cancel(): void {
    if (this.timer !== -1) {
      clearTimeout(this.timer);
      this.timer = -1;
    }
  }
}

@Entry
@Component
struct UtilityTypeExample {
  @State count: number = 0;
  private debouncer: Debouncer = new Debouncer();
  aboutToDisappear(): void { this.debouncer.cancel(); }
  build() {
    Column() {
      Text(`次数: ${this.count}`)
      Button('防抖递增').onClick(() => {
        this.debouncer.schedule(() => { this.count++; }, 300);
      })
    }
  }
}
