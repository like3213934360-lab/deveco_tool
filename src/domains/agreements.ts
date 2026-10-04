import { ToolError } from "../core/errors.js";
import type { UiNode } from "./ui.js";

const legal = /协议|隐私|条款|(?:阅读|用户|服务).{0,12}声明|privacy|terms(?: of (?:use|service))?|licen[cs]e|agreement/i;
const permission = /权限|授权|(?:访问|使用|获取|拍摄|录制|读取).{0,20}(?:相机|摄像头|麦克风|位置|照片|视频|音频|联系人|通讯录|文件)|permission|(?:access (?:to )?|use |read )(?:your |the )?(?:camera|microphone|location|photos|contacts|files)|take pictures|record (?:video|audio)/i;
const allow = /^(?:允许|始终允许|仅在使用(?:期间|中)(?:允许)?|使用(?:时|期间)允许|仅本次允许|仅此一次|授权|确认授权|allow|allow once|allow all|while using (?:the )?app|allow only while using (?:the )?app)$/i;
const positive = /^(?:我(?:已阅读(?:并)?)?)?(?:同意|接受)(?:全部|协议|条款|并继续(?:使用)?|并使用|并开始|并进入|并启用|并授权)?$|^(?:i )?(?:agree|accept)(?: (?:all|and continue|& continue|the terms|the agreement))?$|^(?:已阅读并同意|我已阅读并同意|i have read and agree)/i;
const negative = /不同意|拒绝|不接受|取消|暂不|以后|disagree|decline|reject|cancel|later|not now/i;
const consequential = /购买|支付|订阅|扣款|转账|删除|清空|purchase|pay(?:ment)?|subscribe|transfer|delete|erase/i;

function control(nodes: UiNode[], node: UiNode): UiNode | undefined {
  const byIndex = new Map(nodes.map((n) => [n.i, n]));
  let current: UiNode | undefined = node;
  for (let depth = 0; current && depth < 5; depth++, current = current.parent === null ? undefined : byIndex.get(current.parent)) {
    if (/Input|TextArea|Search/i.test(current.type)) return undefined;
    if (/Button|Checkbox|CheckBox|Toggle|Switch/i.test(current.type) || current.clickable === true) return current;
  }
  return undefined;
}

/** Consent meaning + legal context in the same window; no application name or fixed ids. */
export function agreementAction(nodes: UiNode[]) {
  const visible = nodes.filter((n) => n.visible !== false && n.rect && n.rect.x2 > n.rect.x1 && n.rect.y2 > n.rect.y1);
  const candidates = visible.filter((n) => (positive.test(n.text.trim()) || allow.test(n.text.trim())) && !negative.test(n.text) && !consequential.test(n.text));
  const continuations = visible.filter((n) => /^(?:继续|开始使用|进入应用|continue|next|get started)$/i.test(n.text.trim()));
  candidates.push(...continuations.filter((n) => visible.some((c) => c.window === n.window && c.bundle === n.bundle && control(nodes, c)?.checked === true && positive.test(c.text.trim()) && legal.test(c.text))));
  candidates.sort((a, b) => Number(b.focused === true) - Number(a.focused === true));
  for (const candidate of candidates) {
    const sameWindow = visible.filter((n) => n.window === candidate.window && n.bundle === candidate.bundle);
    const context = allow.test(candidate.text.trim()) ? permission : legal;
    if (!sameWindow.some((n) => n.i !== candidate.i && context.test(n.text) && n.text.length >= 8) && !(typeof control(nodes, candidate)?.checked === "boolean" && legal.test(candidate.text))) continue;
    const button = control(nodes, candidate);
    if (!button || button.visible === false || !button.rect) continue;
    const checkbox = /Checkbox|CheckBox|Toggle|Switch/i.test(button.type);
    if (checkbox && button.checked === true) continue;
    if (button.enabled === false) continue;
    return { node: button, text: candidate.text, kind: checkbox ? "check" : "accept" };
  }
  return undefined;
}

/** Bounded consent loop. A sent click is never retried against an unchanged dialog. */
export async function resolveAgreements(initial: UiNode[], io: { read: () => Promise<UiNode[]>; click: (node: UiNode) => Promise<void>; settleMs?: number }, signal?: AbortSignal) {
  let nodes = initial;
  const accepted: { text: string; kind: string }[] = [], sent = new Set<string>();
  const deadline = Date.now() + Math.min(io.settleMs ?? 0, 1500);
  for (let i = 0; i < 4;) {
    signal?.throwIfAborted();
    const decision = agreementAction(nodes);
    if (!decision) {
      if (Date.now() >= deadline) return { nodes, accepted };
      nodes = await io.read();
      continue;
    }
    const fingerprint = `${decision.node.bundle}|${decision.node.window}|${decision.node.id}|${decision.text}|${JSON.stringify(decision.node.rect)}|${decision.node.checked}`;
    if (sent.has(fingerprint)) throw new ToolError("UI_AGREEMENT_BLOCKED", "Agreement is unchanged after a consent click; no duplicate click was sent", { accepted });
    sent.add(fingerprint);
    await io.click(decision.node);
    i++;
    accepted.push({ text: decision.text.slice(0, 100), kind: decision.kind });
    nodes = await io.read();
  }
  if (agreementAction(nodes)) throw new ToolError("UI_AGREEMENT_BLOCKED", "Agreement chain exceeded four decisions", { accepted });
  return { nodes, accepted };
}
