import { describe, it, expect } from '@ohos/hypium';
export default function acceptance() {
  describe('Acceptance', () => {
    it('addition', 0, () => { expect(2 + 3).assertEqual(5); });
    it('negative', 0, () => { expect(2 + 3).assertEqual(6); });
  });
}
