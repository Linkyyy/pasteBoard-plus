export interface TargetIdentity { window: string; control: string; process: number; elementKey: string }
// Chromium and custom editors may expose a focused HWND without ValuePattern/Edit.
// A missing editable pattern/caret is not evidence that the original target is gone.
export function hasFocusTarget(target: TargetIdentity | null | undefined): target is TargetIdentity {
  return Boolean(target && /^-?[1-9]\d*$/.test(target.window) && target.process > 0
    && (/^-?[1-9]\d*$/.test(target.control) || target.elementKey));
}
