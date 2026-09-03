/**
 * Future application-internal navigation extension point.
 *
 * Version 1 deliberately ships no implementation: every released flow remains portable and uses
 * standard HarmonyOS application launch plus uitest. A later optional ArkTS SDK may implement this
 * port without changing the UiFlow aggregate or the HDC executor.
 */
export class AppNavigatorPort {
  async navigate() {
    const error = new Error("No application-internal ArkPilot navigator is installed");
    error.code = "APP_NAVIGATOR_UNAVAILABLE";
    throw error;
  }
}
