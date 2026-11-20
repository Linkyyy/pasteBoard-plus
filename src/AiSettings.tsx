import { Globe2, Languages, ShieldCheck, Sparkles } from 'lucide-react';
import { AI_PROVIDERS, LANGUAGES, apiBaseUrl, type SettingsInput, type Snapshot } from '../shared/types';
import { AiModeControl } from './AiControls';
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
  function changeProvider(next: Provider) {
    const preset = next === 'custom' ? { apiEndpoint: '', apiModel: '' } : AI_PROVIDERS[next];
    onChange({ ...input, apiEndpoint: preset.apiEndpoint, apiModel: preset.apiModel, apiKey: '', clearApiKey: false });
  }

  return <div className="ai-settings">
    <section className="ai-settings-card" aria-labelledby="clipboard-ai-heading">
      <div className="ai-settings-heading">
        <span className="ai-settings-icon"><Sparkles size={19} /></span>
        <div><h2 id="clipboard-ai-heading">复制后自动处理</h2><p>处理完成后直接粘贴，原文和结果分别存入剪贴板历史。</p></div>
      </div>
      <AiModeControl value={input.clipboardAiMode} onChange={clipboardAiMode => onChange({ ...input, clipboardAiMode })} disabled={!bridge.isDesktop} />
      <p className="field-help">{bridge.isDesktop ? '开启后，新复制的文字会发送到下方配置的 AI 服务。暂停记录可暂停处理。' : '自动作答和自动翻译需要桌面版。'}</p>
    </section>
    <section className="ai-settings-card" aria-labelledby="ai-provider-heading">
      <div className="ai-settings-heading">
        <span className="ai-settings-icon"><Globe2 size={19} /></span>
        <div><h2 id="ai-provider-heading">AI 服务</h2><p>支持 OpenAI、DeepSeek 和兼容 Chat Completions 的接口。</p></div>
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
      <p className="ai-key-note"><ShieldCheck size={15} /> {snapshot.keyStorage === 'secure' ? '密钥使用系统安全存储加密' : '当前环境仅在本次会话保存密钥'}</p>
    </section>
    <section className="ai-settings-card" aria-labelledby="translation-heading">
      <div className="ai-settings-heading">
        <span className="ai-settings-icon"><Languages size={19} /></span>
        <div><h2 id="translation-heading">翻译设置</h2><p>目标语言用于自动翻译，也用于记录内的快捷翻译。</p></div>
      </div>
      <div className="ai-language-fields">
        <div>
          <label className="field-label" htmlFor="target-language">默认目标语言</label>
          <select id="target-language" value={input.targetLanguage} onChange={event => onChange({ ...input, targetLanguage: event.target.value as SettingsInput['targetLanguage'] })}>
            {Object.entries(LANGUAGES).map(([code, label]) => <option value={code} key={code}>{label}</option>)}
          </select>
        </div>
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
      <p className="field-help">内置 TypeLingo 中英日词库，离线精确查词。</p>
    </section>
  </div>;
}
