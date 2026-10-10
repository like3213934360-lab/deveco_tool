import { setTimeout as delay } from "node:timers/promises";
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

export interface AutomaticAction { text: string; kind: string }
export interface AutomaticResult {
  agreements_accepted?: AutomaticAction[];
  onboarding_completed?: AutomaticAction[];
}
type AutomaticSource = AutomaticAction[] | AutomaticResult | undefined;
export function automaticActions(...sources: AutomaticSource[]): AutomaticAction[] {
  return sources.flatMap((source) => Array.isArray(source) ? source : [...(source?.agreements_accepted ?? []), ...(source?.onboarding_completed ?? [])]);
}
export function automaticResult(...sources: AutomaticSource[]): AutomaticResult {
  const actions = automaticActions(...sources);
  const agreements = actions.filter((a) => a.kind !== "onboarding"), onboarding = actions.filter((a) => a.kind === "onboarding");
  return { ...(agreements.length ? { agreements_accepted: agreements } : {}), ...(onboarding.length ? { onboarding_completed: onboarding } : {}) };
}

const onboarding = /^(?:欢迎使用|欢迎体验|首次使用|初次使用|初始设置|初始化设置|设置向导|新手引导|新手教程|功能介绍|新功能介绍|了解新功能|快速入门|开始设置|welcome to|first[- ]time setup|initial setup|setup wizard|getting started|what[’']s new|feature tour|quick start)/i;
const setupChoice = /^(?:请)?选择.{0,24}(?:布局|外观|主题|语言|显示模式|导航方式|操作方式|使用方式)$|^(?:choose|select) (?:your |a |the )?.{0,24}(?:layout|appearance|theme|language|display mode|navigation style)$/i;
const advance = /^(?:下一步|继续|完成|开始使用|立即体验|开始体验|进入应用|我知道了|知道了|next|continue|done|finish|get started|start using|got it)$/i;
const skip = /^(?:跳过|跳过引导|跳过介绍|skip|skip (?:tour|intro|tutorial))$/i;
const sensitiveSetup = /登录|登入|注册|密码|验证码|付款|银行卡|人脸|指纹|login|log in|sign (?:in|up)|password|verification code|credit card|face recognition|fingerprint/i;

/** Setup semantics + controls in one window. Preserve defaults; never invent a preference. */
export function onboardingAction(nodes: UiNode[]) {
  const visible = nodes.filter((n) => n.visible !== false && n.rect && n.rect.x2 > n.rect.x1 && n.rect.y2 > n.rect.y1);
  for (const title of visible.filter((n) => n.text.length <= 100 && !/Input|TextArea|Search/i.test(n.type) && (onboarding.test(n.text.trim()) || setupChoice.test(n.text.trim())))) {
    const window = visible.filter((n) => n.window === title.window && n.bundle === title.bundle);
    if (window.some((n) => consequential.test(n.text) || sensitiveSetup.test(n.text) || legal.test(n.text) || permission.test(n.text) || /Input|TextArea|Search/i.test(n.type))) continue;
    const choices = window.filter((n) => /Radio|Checkbox|CheckBox|Toggle|Switch|Select$/i.test(n.type));
    const selected = choices.filter((n) => n.checked === true || n.selected === true);
    // Radio groups and selects require an existing default. Unchecked switches remain untouched.
    if (choices.some((n) => /Radio|Select$/i.test(n.type)) && !selected.length) continue;
    if (setupChoice.test(title.text.trim()) && !selected.length) continue;
    const buttons = window.filter((n) => advance.test(n.text.trim()) || skip.test(n.text.trim()))
      .map((n) => ({ label: n.text, node: control(nodes, n) }))
      .filter((v) => v.node?.rect && v.node.visible !== false && v.node.enabled !== false);
    const unique = [...new Map(buttons.map((v) => [v.node!.i, v])).values()];
    // Prefer an explicit skip for an informational tour; never skip a choice page.
    const candidates = !choices.length && !setupChoice.test(title.text.trim()) && unique.some((v) => skip.test(v.label.trim()))
      ? unique.filter((v) => skip.test(v.label.trim())) : unique.filter((v) => advance.test(v.label.trim()));
    if (candidates.length !== 1) continue;
    const button = candidates[0]!;
    return { node: button.node!, text: `${title.text}: ${button.label}${selected.length ? ` (${selected.map((n) => n.text).filter(Boolean).join(", ")})` : ""}`, kind: "onboarding" };
  }
  return undefined;
}

/** Bounded automatic handling. A sent click is never retried against an unchanged page. */
export async function resolveAgreements(initial: UiNode[], io: { read: () => Promise<UiNode[]>; click: (node: UiNode) => Promise<void>; settleMs?: number; agreements?: boolean; onboarding?: boolean }, signal?: AbortSignal) {
  let nodes = initial;
  let previous = "", transitionDeadline = 0;
  const accepted: AutomaticAction[] = [], sent = new Set<string>();
  const deadline = Date.now() + Math.min(io.settleMs ?? 0, 1500);
  const decide = () => (io.agreements !== false ? agreementAction(nodes) : undefined) ?? (io.onboarding !== false ? onboardingAction(nodes) : undefined);
  const blocked = (kind: string, message: string) => new ToolError(kind === "onboarding" ? "UI_ONBOARDING_BLOCKED" : "UI_AGREEMENT_BLOCKED", message, { ...automaticResult(accepted) });
  for (let i = 0; i < 8;) {
    signal?.throwIfAborted();
    const decision = decide();
    if (!decision) {
      if (Date.now() >= deadline) return { nodes, accepted };
      nodes = await io.read();
      continue;
    }
    const page = nodes.filter((n) => n.window === decision.node.window && n.bundle === decision.node.bundle && n.visible !== false && (n.text || n.checked !== null || n.selected !== null))
      .map((n) => [n.type, n.text, n.checked, n.selected]);
    const fingerprint = JSON.stringify([decision.node.bundle, decision.node.window, decision.node.id, decision.node.rect, decision.kind, page]);
    if (sent.has(fingerprint)) {
      // Read through a slow transition without resending its click. A cycle is a distinct failure.
      if (fingerprint !== previous || Date.now() >= transitionDeadline)
        throw blocked(decision.kind, "Page is unchanged or cyclic after an automatic click; no duplicate click was sent");
      await delay(100, undefined, { signal });
      nodes = await io.read();
      continue;
    }
    sent.add(fingerprint);
    await io.click(decision.node);
    previous = fingerprint;
    transitionDeadline = Date.now() + 1500;
    i++;
    accepted.push({ text: decision.text.slice(0, 200), kind: decision.kind });
    nodes = await io.read();
  }
  const remaining = decide();
  if (remaining) throw blocked(remaining.kind, "Automatic UI chain exceeded eight decisions");
  return { nodes, accepted };
}
