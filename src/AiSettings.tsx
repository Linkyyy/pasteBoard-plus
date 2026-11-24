import { Globe2, ShieldCheck, Sparkles } from 'lucide-react';
import {
  AI_MODE_LABELS, AI_PROVIDERS, CLIPBOARD_AI_MODES, LANGUAGES, apiBaseUrl,
  type ClipboardAiMode, type Language, type SettingsInput, type Snapshot,
} from '../shared/types';
import { bridge } from './bridge';

type Provider = keyof typeof AI_PROVIDERS | 'custom';

export default function AiSettings({ input, snapshot, onChange }: {
  input: SettingsInput;
  snapshot: Snapshot;
  onChange(value: SettingsInput): void;
}) {
  const endpoint = apiBaseUrl(input.apiEndpoint);
  const provider = (Object.keys(AI_PROVIDERS) as (keyof typeof AI_PROVIDERS)[])
    .find(name => AI_PROVIDERS[name].apiEndpoint === endpoint) ?? 'custom';
  const hasSavedKey = snapshot.hasApiKey && apiBaseUrl(snapshot.settings.apiEndpoint) === endpoint;
  const status = snapshot.clipboardAi;

  function changeProvider(next: Provider) {
    const preset = next === 'custom' ? { apiEndpoint: '', apiModel: '' } : AI_PROVIDERS[next];
    onChange({ ...input, apiEndpoint: preset.apiEndpoint, apiModel: preset.apiModel, apiKey: '', clearApiKey: false });
  }

  return <>
    <div className="settings-section-title"><Sparkles size={18} /><div>
      <h3>AI 作答与翻译</h3>
      <p>连接 OpenAI、DeepSeek 或兼容 Chat Completions 的服务。</p>
    </div></div>
    <div className="two-fields">
      <div>
        <label className="field-label" htmlFor="clipboard-ai-mode">自动处理模式</label>
        <select id="clipboard-ai-mode" value={input.clipboardAiMode} disabled={!bridge.isDesktop}
          onChange={event => onChange({ ...input, clipboardAiMode: event.target.value as ClipboardAiMode })}>
          {CLIPBOARD_AI_MODES.map(mode => <option key={mode} value={mode}>{AI_MODE_LABELS[mode]}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="target-language">默认目标语言</label>
        <select id="target-language" value={input.targetLanguage} onChange={event => onChange({ ...input, targetLanguage: event.target.value as Language })}>
          {Object.entries(LANGUAGES).map(([code, label]) => <option value={code} key={code}>{label}</option>)}
        </select>
      </div>
    </div>
    {bridge.isDesktop && input.clipboardAiMode === 'answer' && <div>
      <label className="field-label" htmlFor="answer-prompt">作答提示词</label>
      <textarea id="answer-prompt" rows={3} value={input.answerPrompt} aria-describedby="answer-prompt-help"
        placeholder="例如，先给出选项，再用一句话解释。"
        onChange={event => onChange({ ...input, answerPrompt: event.target.value })} />
      <p id="answer-prompt-help" className="field-help">留空使用默认提示词。答案以纯文本输出。</p>
    </div>}
    <p className="field-help">{bridge.isDesktop ? '开启后，新复制的文字会发送给所选服务。原文和结果分别存入历史。' : '自动作答和自动翻译需要桌面版。'}</p>
    {status?.state === 'error' ? <div className="form-error" role="alert">{status.message}</div> : status && <div className="inline-note" role="status">
      {status.state === 'working' ? '正在处理新复制的文字…' : status.clipboardUpdated ? '结果已复制，可以直接粘贴' : '结果已保存，可从历史选择'}
    </div>}

    <div className="dictionary-status"><Globe2 size={25} /><div>
      <strong>TypeLingo 中英日词库</strong>
      <span>32,159 条六向查询记录 · 离线可用</span>
      <p>词库按词条精确匹配，遇到歧义会提示。整句翻译可使用 AI 服务。</p>
    </div></div>
    <div className="two-fields">
      <div>
        <label className="field-label" htmlFor="translation-mode">手动翻译方式</label>
        <select id="translation-mode" value={input.translationMode} onChange={event => onChange({ ...input, translationMode: event.target.value as SettingsInput['translationMode'] })}>
          <option value="auto">自动选择 AI 或本地词库</option><option value="local">本地词库（离线）</option><option value="ai">AI API</option>
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="source-language">词库原文语言</label>
        <select id="source-language" value={input.sourceLanguage} onChange={event => onChange({ ...input, sourceLanguage: event.target.value as SettingsInput['sourceLanguage'] })}>
          <option value="auto">自动检测</option><option value="zh-CN">简体中文</option><option value="en">英语</option><option value="ja">日语</option>
        </select>
      </div>
    </div>
    <div className="two-fields">
      <div>
        <label className="field-label" htmlFor="api-provider">服务商</label>
        <select id="api-provider" value={provider} onChange={event => changeProvider(event.target.value as Provider)}>
          {Object.entries(AI_PROVIDERS).map(([id, preset]) => <option value={id} key={id}>{preset.name}</option>)}
          <option value="custom">自定义兼容接口</option>
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="api-model">模型名称</label>
        <input id="api-model" value={input.apiModel} onChange={event => onChange({ ...input, apiModel: event.target.value })} placeholder="输入服务商支持的模型名" spellCheck={false} />
      </div>
    </div>
    <label className="field-label" htmlFor="api-endpoint">API 服务地址</label>
    <input id="api-endpoint" type="url" value={input.apiEndpoint} onChange={event => onChange({ ...input, apiEndpoint: event.target.value })} placeholder="https://api.openai.com/v1" spellCheck={false} />
    <div className="field-label-row">
      <label className="field-label" htmlFor="api-key">API 密钥</label>
      {hasSavedKey && !input.clearApiKey && <button className="text-button danger" onClick={() => onChange({ ...input, clearApiKey: true, apiKey: '' })}>移除已存密钥</button>}
    </div>
    <input id="api-key" type="password" autoComplete="off" value={input.apiKey || ''} onChange={event => onChange({ ...input, apiKey: event.target.value, clearApiKey: false })}
      placeholder={input.clearApiKey ? '保存后移除密钥' : hasSavedKey ? '已配置 · 留空保留原密钥' : '输入此服务的 API Key'} />
    <div className="privacy-note"><ShieldCheck size={18} /><div>
      <strong>{snapshot.keyStorage === 'secure' ? '密钥使用系统安全存储加密' : '当前环境仅在本次会话保存密钥'}</strong>
      <p>手动翻译发送所选记录的文字。{snapshot.keyStorage === 'session' && '退出后需要重新填写密钥。'}</p>
    </div></div>
  </>;
}
