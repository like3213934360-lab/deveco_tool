import { formBindingData, FormExtensionAbility, formInfo, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
export default class ProbeForm extends FormExtensionAbility {
  onAddForm(want: Want) {
    hilog.info(0, 'ProbeForm', 'added');
    return formBindingData.createFormBindingData({ message: 'Card ready' });
  }
  onUpdateForm(formId: string) { this.refresh(formId); }
  onFormEvent(formId: string, message: string) { this.refresh(formId, "Card tapped"); }
  private refresh(formId: string, message: string = "Card refreshed") {
    formProvider.updateForm(formId, formBindingData.createFormBindingData({ message })).then(() => {
      hilog.info(0, 'ProbeForm', 'refreshed');
    }).catch((error: Error) => { hilog.error(0, 'ProbeForm', 'refresh failed: %{public}s', error.message); });
  }
  onRemoveForm(formId: string) { hilog.info(0, 'ProbeForm', 'removed'); }
  onAcquireFormState(want: Want) { return formInfo.FormState.READY; }
}
