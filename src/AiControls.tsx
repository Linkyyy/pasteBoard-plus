import { Check, Languages, LoaderCircle, Power, Sparkles } from 'lucide-react';
import { AI_MODE_LABELS, CLIPBOARD_AI_MODES, type ClipboardAiMode, type Snapshot } from '../shared/types';

const modeIcons = { off: Power, answer: Sparkles, translate: Languages };

export function AiModeControl({ value, onChange, disabled = false }: {
  value: ClipboardAiMode;
  onChange(mode: ClipboardAiMode): void;
  disabled?: boolean;
}) {
  return <div className="ai-mode-control" role="group" aria-label="剪贴板 AI 模式">
    {CLIPBOARD_AI_MODES.map(mode => {
      const Icon = modeIcons[mode];
      return <button key={mode} type="button" aria-pressed={value === mode} disabled={disabled} onClick={() => onChange(mode)}>
        <Icon size={15} aria-hidden="true" />
        {AI_MODE_LABELS[mode]}
      </button>;
    })}
  </div>;
}

export function AiStatus({ status }: { status: Snapshot['clipboardAi'] }) {
  if (!status) return null;
  if (status.state === 'error') return <p className="clipboard-ai-status error" role="alert">{status.message}</p>;
  if (status.state === 'working') return <p className="clipboard-ai-status" role="status">
    <LoaderCircle size={14} className="spin" aria-hidden="true" /> 正在处理新复制的文字…
  </p>;
  return <p className="clipboard-ai-status ready" role="status">
    <Check size={14} aria-hidden="true" /> {status.clipboardUpdated ? '结果已复制，可以直接粘贴' : '结果已保存，可从历史选择'}
  </p>;
}
