import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, ArrowDownUp, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, Clipboard, ClipboardCheck, Code2, Copy, Folder, FolderOpen, Globe2, Image as ImageIcon, Keyboard, LayoutGrid, List, LoaderCircle, Maximize2, Minus, MoreHorizontal, Pause, Pin, Play, Plus, Search, Settings2, ShieldCheck, Sparkles, Tag, Trash2, X } from 'lucide-react';
import { bridge } from './bridge';
import CompactBoard from './CompactBoard';
import { titleOf } from '../shared/classify';
import { DEFAULT_SETTINGS, LANGUAGES, type ClipboardEntry, type ContentKind, type Language, type SettingsInput, type Snapshot } from '../shared/types';

const kindLabels: Record<ContentKind, string> = { text: '文本', image: '图片', url: '链接', path: '文件路径', code: '代码' };
const kindIcons = { text: AlignLeft, image: ImageIcon, url: Globe2, path: FolderOpen, code: Code2 };
const initial: Snapshot = { windowMode: 'compact', entries: [], categories: [], settings: DEFAULT_SETTINGS, hasApiKey: false, keyStorage: 'session', shortcutRegistered: false, warning: null };
type Toast = { message: string; error?: boolean };

function relativeTime(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return '刚刚'; if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function shortcutParts(shortcut: string) { return shortcut.replace('CommandOrControl', bridge.platform === 'darwin' ? '⌘' : 'Ctrl').replace('Control', 'Ctrl').replace('Super', 'Win').split('+'); }
function Shortcut({ value, small = false }: { value: string; small?: boolean }) { return <span className={`shortcut ${small ? 'small' : ''}`}>{shortcutParts(value).map((part, i) => <kbd key={i}>{part}</kbd>)}</span>; }
function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () => Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]') || []);
    (container.current?.querySelector<HTMLElement>('input, select, textarea') || focusable()[0])?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={container} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button></div>{children}
  </div></div>;
}

function EntryCard({ entry, selected, layout, onSelect, onCopy, onPin, categoryName }: { entry: ClipboardEntry; selected: boolean; layout: string; onSelect(): void; onCopy(): void; onPin(): void; categoryName?: string }) {
  const Icon = kindIcons[entry.kind];
  return <article className={`entry-card ${selected ? 'selected' : ''} kind-${entry.kind} ${layout === 'list' ? 'list-card' : ''}`} data-testid="entry-card">
    <button className="entry-content" onClick={onSelect} aria-label={`查看：${titleOf(entry.content, entry.kind)}`} aria-pressed={selected}>
      {entry.kind === 'image' && entry.image ? <div className="card-image"><img src={entry.image.thumbnail} alt="剪贴板图片缩略图" /><span className="image-dimensions">{entry.image.width} × {entry.image.height}</span></div> : <div className="card-text">
        <div className="card-heading"><span className={`type-icon ${entry.kind}`}><Icon size={16} /></span><h3>{titleOf(entry.content, entry.kind)}</h3></div>
        {entry.kind === 'url' ? <><p className="url-preview">{entry.content}</p><div className="link-caption"><Globe2 size={13} /> 网页链接 <ArrowRight size={13} /></div></> : entry.kind === 'path' ? <div className="path-preview"><Folder size={23} strokeWidth={1.5} /><p>{entry.content}</p></div> : <p className={`text-preview ${entry.kind === 'code' ? 'code-preview' : ''}`}>{entry.content}</p>}
      </div>}
    </button>
    <div className="card-footer"><span className={`kind-dot ${entry.kind}`} /><span>{kindLabels[entry.kind]}</span>{categoryName && <span className="card-category">{categoryName}</span>}<span className="card-time">{relativeTime(entry.updatedAt)}</span><button className={`card-pin ${entry.pinned ? 'is-pinned' : ''}`} onClick={onPin} title={entry.pinned ? '取消置顶' : '置顶记录'} aria-label={entry.pinned ? '取消置顶' : '置顶记录'}><Pin size={13} fill={entry.pinned ? 'currentColor' : 'none'} /></button><button className="card-copy" onClick={onCopy} aria-label="复制记录" title="复制记录"><Copy size={14} /></button></div>
  </article>;
}

function SettingsModal({ snapshot, initialTab, onClose, onSaved }: { snapshot: Snapshot; initialTab: 'general' | 'ai'; onClose(): void; onSaved(message: string): void }) {
  const [tab, setTab] = useState(initialTab);
  const [input, setInput] = useState<SettingsInput>({ ...snapshot.settings });
  const [recording, setRecording] = useState(false);
  const [customCapacity, setCustomCapacity] = useState(![0,50,100,300,500,1000,10000,100000].includes(snapshot.settings.historyLimit));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [onClose]);
  async function save() {
    setSaving(true); setError('');
    try { await bridge.saveSettings(input); onSaved('设置已保存'); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <div className="fluent-settings" role="dialog" aria-label="偏好设置" aria-modal="true">
    <header className="fluent-settings-caption"><button onClick={onClose} aria-label="关闭弹窗"><ArrowLeft size={18} /></button><span>设置</span><div className="fluent-settings-search"><Search size={17} /><input aria-label="搜索设置" placeholder="查找设置" value={settingsSearch} onChange={event => { const query = event.target.value; setSettingsSearch(query); if (/api|翻译|语言|词库|模型|密钥/i.test(query)) setTab('ai'); else if (/快捷|历史|记录|图片|字体|粘贴|常规/i.test(query)) setTab('general'); }} /></div>{bridge.isDesktop && <div className="window-actions"><button onClick={() => void bridge.windowAction('minimize')} aria-label="最小化窗口"><Minus size={15} /></button><button onClick={() => void bridge.windowAction('maximize')} aria-label="最大化窗口"><Maximize2 size={13} /></button><button onClick={onClose} aria-label="关闭设置"><X size={18} /></button></div>}</header>
    <div className="fluent-settings-layout"><aside className="fluent-settings-nav"><div className="fluent-settings-profile"><img src="./icon.svg" alt="" /><div><strong>我的剪贴板</strong><span>PasteBoard Plus · 本机</span></div></div><button className={tab === 'general' ? 'active' : ''} onClick={() => { setTab('general'); setSettingsSearch(''); }}><Settings2 size={19} />常规与历史</button><button className={tab === 'ai' ? 'active' : ''} onClick={() => { setTab('ai'); setSettingsSearch(''); }}><Sparkles size={19} />翻译与词库</button><button onClick={onClose}><Clipboard size={19} />返回剪贴板</button><div className="fluent-settings-nav-footer"><ShieldCheck size={17} /><span>历史在本机保存<br />中英日本地词库已内置</span></div></aside><main className="fluent-settings-main"><div className="fluent-settings-page-title"><h1>{tab === 'general' ? '常规与历史' : '翻译与词库'}</h1><p>{tab === 'general' ? '自定义剪贴板的显示、快捷键和记录方式。' : '选择离线词库，或连接你自己的 AI 翻译服务。'}</p></div>
    <div className="settings-body">{tab === 'general' ? <>
      <div className="settings-section-title"><Keyboard size={18} /><div><h3>随时，唤起灵感</h3><p>在任何应用中，按下快捷键打开或收起剪贴板。</p></div></div>
      <label className="field-label">全局唤出快捷键</label><button className={`shortcut-recorder ${recording ? 'recording' : ''}`} onClick={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={event => {
        if (!recording) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { setRecording(false); return; }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : event.code === 'Space' ? 'Space' : /^F\d+$/.test(event.code) ? event.code : '';
        const modifiers = [event.ctrlKey || (event.metaKey && bridge.platform === 'darwin') ? 'CommandOrControl' : '', event.metaKey && bridge.platform !== 'darwin' ? 'Super' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
        if (!key || !modifiers.length) { setError('请使用 Ctrl、Alt、Shift 或 Command 与字母 / 数字的组合。'); return; }
        setInput({ ...input, shortcut: [...modifiers, key].join('+') }); setRecording(false); setError('');
      }} aria-label="录制全局快捷键"><Shortcut value={input.shortcut} /><span>{recording ? '请按下新的组合键…' : '点击修改'}<Keyboard size={16} /></span></button>
      <p className="field-help">Windows + V 由系统占用，建议使用 Ctrl + Shift + V。快捷键冲突时会提示更换。</p>
      {!bridge.isDesktop && <div className="inline-note"><Globe2 size={16} /> 浏览器预览不注册系统快捷键；桌面版支持全局唤出和自动记录。</div>}
      <div className="field-row"><div><label htmlFor="history-limit" className="field-label">历史记录容量</label><p className="field-help">默认无限条；自定义为 0 表示不限制。有限容量下会保留置顶。</p></div><div className="capacity-controls"><select id="history-limit" value={customCapacity ? 'custom' : input.historyLimit} onChange={event => { const custom = event.target.value === 'custom'; setCustomCapacity(custom); if (!custom) setInput({ ...input, historyLimit: Number(event.target.value) }); }}>{[0,50,100,300,500,1000,10000,100000].map(n => <option key={n} value={n}>{n === 0 ? '无限制（默认）' : `${n} 条`}</option>)}<option value="custom">自定义</option></select>{customCapacity && <input type="number" min="0" step="1" aria-label="自定义历史条数" value={input.historyLimit} onChange={event => setInput({ ...input, historyLimit: Number(event.target.value) })} />}</div></div>
      <div className="field-row"><div><label className="field-label" htmlFor="capture-enabled">自动记录剪贴板</label><p className="field-help">只在本机保存；被来源应用标记为敏感的内容会跳过。</p></div><button id="capture-enabled" role="switch" aria-checked={input.captureEnabled} className={`toggle ${input.captureEnabled ? 'on' : ''}`} onClick={() => setInput({ ...input, captureEnabled: !input.captureEnabled })}><span /></button></div>
      <div className="field-row"><div><label className="field-label" htmlFor="capture-images">记录图片</label><p className="field-help">默认关闭；开启后保存新复制的图片原图，不限制大小。</p></div><button id="capture-images" role="switch" aria-checked={input.captureImages} className={`toggle ${input.captureImages ? 'on' : ''}`} onClick={() => setInput({ ...input, captureImages: !input.captureImages })}><span /></button></div>
      <p className="field-help">文件及文件路径不会加入新的剪贴板历史。</p>
      <div className="field-row"><div><label className="field-label" htmlFor="auto-paste">自动粘贴到原输入框</label><p className="field-help">Windows：唤出时保留原焦点，点击词条后粘贴并收起。</p></div><button id="auto-paste" role="switch" aria-checked={input.autoPaste} className={`toggle ${input.autoPaste ? 'on' : ''}`} onClick={() => setInput({ ...input, autoPaste: !input.autoPaste })}><span /></button></div>
      <div className="field-row"><div><label className="field-label" htmlFor="font-size">文字大小</label><p className="field-help">调整小窗口词条文字，让内容更清晰。</p></div><select id="font-size" value={input.fontSize} onChange={event => setInput({ ...input, fontSize: Number(event.target.value) as 14 | 16 | 18 })}><option value="14">标准 · 14</option><option value="16">较大 · 16</option><option value="18">大 · 18</option></select></div>
    </> : <>
      <div className="settings-section-title"><Sparkles size={18} /><div><h3>让文字，跨越语言</h3><p>连接兼容 OpenAI Chat Completions 的 API 服务。</p></div></div>
      <div className="dictionary-status"><Globe2 size={25} /><div><strong>TypeLingo 中英日词库</strong><span>32,159 条六向查询记录 · 离线可用</span><p>仅按词条精确匹配；歧义词不会自动选义。未命中可配置 AI 翻译整句。</p></div></div>
      <div className="two-fields"><div><label className="field-label" htmlFor="translation-mode">翻译方式</label><select id="translation-mode" value={input.translationMode} onChange={event => setInput({ ...input, translationMode: event.target.value as SettingsInput['translationMode'] })}><option value="auto">自动：有 API 用 AI，否则本地词库</option><option value="local">仅本地词库（离线）</option><option value="ai">仅 AI API</option></select></div><div><label className="field-label" htmlFor="source-language">原文语言</label><select id="source-language" value={input.sourceLanguage} onChange={event => setInput({ ...input, sourceLanguage: event.target.value as SettingsInput['sourceLanguage'] })}><option value="auto">自动检测</option><option value="zh-CN">简体中文</option><option value="en">英语</option><option value="ja">日语</option></select></div></div>
      <label className="field-label" htmlFor="api-endpoint">API 服务地址</label><input id="api-endpoint" type="url" value={input.apiEndpoint} onChange={event => setInput({ ...input, apiEndpoint: event.target.value })} placeholder="https://api.openai.com/v1" spellCheck={false} /><p className="field-help">填写以 /v1 结尾的基础地址。支持 HTTPS 和本地 HTTP 服务。</p>
      <div className="two-fields"><div><label className="field-label" htmlFor="api-model">模型名称</label><input id="api-model" value={input.apiModel} onChange={event => setInput({ ...input, apiModel: event.target.value })} placeholder="gpt-4o-mini" spellCheck={false} /></div><div><label className="field-label" htmlFor="target-language">默认目标语言</label><select id="target-language" value={input.targetLanguage} onChange={event => setInput({ ...input, targetLanguage: event.target.value as Language })}>{Object.entries(LANGUAGES).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></div></div>
      <div className="field-label-row"><label className="field-label" htmlFor="api-key">API 密钥</label>{snapshot.hasApiKey && !input.clearApiKey && <button className="text-button danger" onClick={() => setInput({ ...input, clearApiKey: true, apiKey: '' })}>移除已存密钥</button>}</div><input id="api-key" type="password" autoComplete="off" value={input.apiKey || ''} onChange={event => setInput({ ...input, apiKey: event.target.value, clearApiKey: false })} placeholder={input.clearApiKey ? '保存后移除密钥' : snapshot.hasApiKey ? '已配置 · 留空保留原密钥' : '输入你的 API Key'} />
      <div className="privacy-note"><ShieldCheck size={18} /><div><strong>{snapshot.keyStorage === 'secure' ? '密钥使用系统安全存储加密' : '当前环境仅在本次会话保存密钥'}</strong><p>只有点击翻译时，选中的文字才会发送到你配置的服务。{snapshot.keyStorage === 'session' ? '系统安全存储不可用，退出后需要重新填写密钥。' : '密钥不会发送给其他服务，也不会写入历史记录。'}图片暂不支持 OCR。</p></div></div>
    </>}{error && <div className="form-error" role="alert">{error}</div>}</div>
    <div className="modal-footer fluent-settings-footer"><span><ShieldCheck size={14} /> 未配置 API 时使用本地词库</span><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving && <LoaderCircle size={15} className="spin" />}保存设置</button></div></main></div>
  </div>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState('grid');
  const [sort, setSort] = useState('recent');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'original' | 'translation'>('original');
  const [language, setLanguage] = useState<Language>('zh-CN');
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'general' | 'ai' | null>(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [clearModal, setClearModal] = useState(false);
  const [clearPinned, setClearPinned] = useState(false);
  const [deleteCategoryModal, setDeleteCategoryModal] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnToCompact = useRef(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const { entries, categories, settings } = snapshot;
  const notify = (message: string, error = false) => setToast({ message, error });
  async function run(action: () => Promise<unknown>, success?: string) { try { await action(); if (success) notify(success); } catch (error) { notify(error instanceof Error ? error.message : '操作失败，请重试', true); } }

  useEffect(() => {
    let active = true;
    const unsubscribe = bridge.onChange(next => { if (active) setSnapshot(next); });
    void bridge.getSnapshot().then(next => { if (active) { setSnapshot(next); setLanguage(next.settings.targetLanguage); setLoaded(true); } }).catch(error => { setLoaded(true); setToast({ message: String(error), error: true }); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { setLanguage(settings.targetLanguage); }, [settings.targetLanguage]);
  useEffect(() => {
    if (snapshot.windowMode === 'compact') { setSettingsTab(null); setCategoryModal(false); setClearModal(false); setDeleteCategoryModal(false); setImagePreview(null); }
  }, [snapshot.windowMode]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 6500 : 3000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = setInterval(() => setSnapshot(current => ({ ...current })), 60_000); return () => clearInterval(timer); }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries.filter(entry => (filter === 'all' || (filter === 'pinned' ? entry.pinned : filter.startsWith('category:') ? entry.categoryId === filter.slice(9) : entry.kind === filter)) && (!query || `${entry.content} ${entry.translation?.text || ''} ${titleOf(entry.content, entry.kind)}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'oldest' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
  }, [entries, filter, search, sort]);
  useEffect(() => setVisibleCount(60), [filter, search, sort]);
  const selected = filtered.find(entry => entry.id === selectedId) || filtered[0];
  const currentCategory = categories.find(category => `category:${category.id}` === filter);
  const filterLabel = filter === 'all' ? '所有记录' : filter === 'pinned' ? '置顶收藏' : currentCategory?.name || kindLabels[filter as ContentKind] || '所有记录';
  const pinnedCount = entries.filter(entry => entry.pinned).length;
  const counts = Object.fromEntries(Object.keys(kindLabels).map(kind => [kind, entries.filter(entry => entry.kind === kind).length]));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (snapshot.windowMode === 'compact') return;
      if (settingsTab || categoryModal || clearModal || imagePreview || deleteCategoryModal) return;
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); setSettingsTab('general'); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus(); return; }
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === 'Escape') { if (detailOpen && window.innerWidth <= 900) setDetailOpen(false); else if (search) setSearch(''); else void bridge.windowAction('hide'); }
      const index = filtered.findIndex(entry => entry.id === selected?.id);
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); setSelectedId(filtered[Math.min(index + 1, filtered.length - 1)]?.id || null); setDetailTab('original'); }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); setSelectedId(filtered[Math.max(index - 1, 0)]?.id || null); setDetailTab('original'); }
      if (event.key === 'Enter' && selected) { event.preventDefault(); void run(() => bridge.copy(selected.id, true), '已复制，返回原应用后粘贴'); }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function changeFilter(next: string) { setFilter(next); setSelectedId(null); setDetailTab('original'); }
  async function translate() {
    if (!selected) return;
    const id = selected.id;
    setDetailTab('translation'); setTranslatingId(id);
    await run(() => bridge.translate(id, language), '译文已保存'); setTranslatingId(null);
  }
  async function openManager(id?: string) {
    returnToCompact.current = false;
    if (id) { setSelectedId(id); setFilter('all'); setSearch(''); setDetailTab('original'); }
    await run(() => bridge.setWindowMode('manager'));
  }
  async function openCompactSettings(initialTab: 'general' | 'ai' = 'general') {
    returnToCompact.current = true;
    await run(async () => { await bridge.setWindowMode('manager'); setSettingsTab(initialTab); });
  }
  function closeSettings() {
    setSettingsTab(null);
    if (returnToCompact.current) { returnToCompact.current = false; void run(() => bridge.setWindowMode('compact')); }
  }
  const navItem = (id: string, label: string, icon: ReactNode, count?: number) => <button key={id} className={`nav-item ${filter === id ? 'active' : ''}`} onClick={() => changeFilter(id)}><span className="nav-icon">{icon}</span><span>{label}</span><span className="nav-count">{count ?? ''}</span></button>;

  if (snapshot.windowMode === 'compact') return <><CompactBoard snapshot={snapshot} onManage={id => void openManager(id)} onSettings={tab => void openCompactSettings(tab)} onError={message => notify(message, true)} />{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.message}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}</>;
  if (settingsTab) return <><SettingsModal snapshot={snapshot} initialTab={settingsTab} onClose={closeSettings} onSaved={message => notify(message)} />{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.message}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}</>;
  return <div className="application">
    <header className="titlebar"><div className="titlebar-brand"><img src="./icon.svg" alt="" /><span>PasteBoard <strong>Plus</strong></span><span className="version-badge">{bridge.isDesktop ? '0.1' : '浏览器预览'}</span></div><button className="return-compact" onClick={() => void run(() => bridge.setWindowMode('compact'))}><ArrowLeft size={13} /> 返回小窗口</button><div className="titlebar-center">给每一次复制，一个好去处。</div>{bridge.isDesktop ? <div className="window-actions"><button aria-label="最小化窗口" onClick={() => void bridge.windowAction('minimize')}><Minus size={15} /></button><button aria-label="最大化窗口" onClick={() => void bridge.windowAction('maximize')}><Maximize2 size={12} /></button><button aria-label="收起到托盘" onClick={() => void bridge.windowAction('hide')}><X size={16} /></button></div> : <span className="preview-label"><Globe2 size={12} /> WEB PREVIEW</span>}</header>
    <div className="workspace">
      <aside className="sidebar"><div className="workspace-label"><div className="workspace-avatar"><Clipboard size={17} /></div><div><strong>我的剪贴板</strong><span>你的灵感中转站</span></div><ChevronDown size={14} /></div>
        <div className="navigation"><span className="section-label">工作空间</span>{navItem('all', '所有记录', <LayoutGrid size={17} />, entries.length)}{navItem('pinned', '置顶收藏', <Pin size={17} />, pinnedCount)}
          <span className="section-label category-label">智能分类</span>{Object.entries(kindLabels).map(([kind, label]) => { const Icon = kindIcons[kind as ContentKind]; return navItem(kind, label, <Icon size={17} />, counts[kind]); })}
          <div className="section-label custom-label">我的分类<button className="sidebar-add" onClick={() => { setCategoryModal(true); setCategoryError(''); setCategoryName(''); }} aria-label="新建分类"><Plus size={15} /></button></div>
          {categories.map(category => navItem(`category:${category.id}`, category.name, <span className="category-dot" style={{ background: category.color }} />, entries.filter(entry => entry.categoryId === category.id).length))}
          {!categories.length && <button className="empty-category" onClick={() => setCategoryModal(true)}><Plus size={14} /> 创建你的第一个分类</button>}
        </div>
        <div className="sidebar-bottom"><div className="storage-info"><span>本地历史记录</span><strong>{entries.length}<span> / {settings.historyLimit === 0 ? '∞' : settings.historyLimit}</span></strong><div className="storage-track"><div style={{ width: `${Math.min(100, (settings.historyLimit === 0 ? 0 : (entries.length - pinnedCount) / settings.historyLimit * 100))}%` }} /></div><p><ShieldCheck size={12} /> 本地存储，安心留存</p></div><button className="sidebar-settings" onClick={() => setSettingsTab('general')}><Settings2 size={17} /> 偏好设置<span>{bridge.platform === 'darwin' ? '⌘' : 'Ctrl'} ,</span></button><div className="sidebar-signature"><span className="tiny-logo">p<span>+</span></span> Small things. Better flow.</div></div>
      </aside>

      <main className="main-panel"><div className="main-heading"><div className="breadcrumb">工作空间 <ChevronRight size={12} /> 剪贴板</div><div className="heading-row"><div><h1>{filterLabel}<span className="heading-count">{filtered.length}</span></h1><p>留住刚刚复制的，也留住转瞬即逝的灵感。</p></div><button className="button secondary capture-button" onClick={() => void run(async () => { const result = await bridge.capture(); notify(result.message); })}><Plus size={16} /> 捕获剪贴板</button></div>
        <div className="toolbar"><div className="search-box"><Search size={17} /><input ref={searchRef} aria-label="搜索历史记录" placeholder="搜索内容、链接或译文…" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={14} /></button> : <span className="search-key">{bridge.platform === 'darwin' ? '⌘' : 'Ctrl'} F</span>}</div><div className="layout-switch"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图"><LayoutGrid size={16} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图"><List size={17} /></button></div><details className="more-menu"><summary aria-label="更多操作"><MoreHorizontal size={20} /></summary><div><button onClick={() => { setClearModal(true); setClearPinned(false); }}><Trash2 size={15} /> 清理历史记录</button>{currentCategory && <button onClick={() => setDeleteCategoryModal(true)}><Tag size={15} /> 删除当前分类</button>}</div></details></div>
      </div>
        {snapshot.warning && <div className="warning-banner" role="alert">{snapshot.warning}</div>}
        {!bridge.isDesktop && <div className="browser-banner"><Globe2 size={14} /><span>浏览器预览 · 历史仅保存在此浏览器；自动监听和全局快捷键请使用桌面版。</span>{entries.length === 0 && <button onClick={() => void run(() => bridge.loadExamples!())}>查看示例 <ArrowRight size={13} /></button>}</div>}
        <div className="records-scroll"><div className="records-subheading"><span>{search ? '搜索结果' : filter === 'pinned' ? '重要的，值得留下' : '最近记录'}<span className="subheading-dot">·</span>{filtered.length} 条</span><label className="sort-control"><ArrowDownUp size={13} /><select aria-label="排序方式" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最新在前</option><option value="oldest">最早在前</option></select></label></div>
          {!loaded ? <div className="empty-state"><LoaderCircle className="spin" size={26} /><h2>正在打开你的剪贴板…</h2></div> : filtered.length ? <div className={`entries ${layout}`}>{filtered.slice(0, visibleCount).map(entry => <EntryCard key={entry.id} entry={entry} selected={selected?.id === entry.id} layout={layout} categoryName={categories.find(category => category.id === entry.categoryId)?.name} onSelect={() => { setSelectedId(entry.id); setDetailTab('original'); setDetailOpen(true); }} onCopy={() => void run(() => bridge.copy(entry.id), '已复制到剪贴板')} onPin={() => void run(() => bridge.pin(entry.id), entry.pinned ? '已取消置顶' : '已置顶，清理时会保留')} />)}</div> : <div className="empty-state"><div className="empty-illustration"><div className="empty-paper back" /><div className="empty-paper front"><Clipboard size={32} strokeWidth={1.3} /><span /><span /></div><span className="empty-spark">✦</span></div><span className="eyebrow">A LITTLE SPACE FOR YOUR IDEAS</span><h2>{search ? '还没有找到这段灵感' : filter !== 'all' ? '这个分类，还在等待灵感' : '下一次复制，从这里开始'}</h2><p>{search ? '换个关键词试试，或搜索译文中的内容。' : bridge.isDesktop ? '复制文字、链接或图片，它们会自动出现在这里。\n不用整理，也不会轻易丢失。' : '在桌面版中，每次复制都会自动留存。\n现在可以捕获一段文字，或载入示例体验界面。'}</p>{search ? <button className="button secondary" onClick={() => setSearch('')}>清空搜索</button> : !bridge.isDesktop && entries.length === 0 ? <button className="button primary" onClick={() => void run(() => bridge.loadExamples!())}>体验示例 <ArrowRight size={15} /></button> : <div className="empty-shortcut"><span>随时唤出</span><Shortcut value={settings.shortcut} small /></div>}</div>}
          {filtered.length > visibleCount && <button className="button secondary load-records" onClick={() => setVisibleCount(count => count + 60)}>加载更早的记录（还有 {filtered.length - visibleCount} 条）</button>}{filtered.length > 0 && <div className="records-end"><span />已经是全部记录了<span /></div>}
        </div>
        <footer className="main-status"><button className={`capture-status ${settings.captureEnabled ? 'enabled' : ''}`} onClick={() => void run(() => bridge.saveSettings({ ...settings, captureEnabled: !settings.captureEnabled }), settings.captureEnabled ? '已暂停记录' : '已继续记录')}><span className="status-dot" />{bridge.isDesktop ? settings.captureEnabled ? '正在记录剪贴板' : '已暂停记录' : '浏览器手动捕获'}{settings.captureEnabled ? <Pause size={11} /> : <Play size={11} />}</button><button className="status-shortcut" onClick={() => setSettingsTab('general')}><Keyboard size={13} /><Shortcut value={settings.shortcut} small /><span>唤出{bridge.isDesktop && !snapshot.shortcutRegistered ? ' · 未注册' : ''}</span></button></footer>
      </main>

      <aside className={`detail-panel ${detailOpen ? 'mobile-open' : ''}`}><div className="detail-heading"><span>内容详情</span><span className="detail-label">INSPECTOR</span><button className="icon-button mobile-detail-close" aria-label="关闭详情" onClick={() => setDetailOpen(false)}><X size={18} /></button></div>{selected ? <>
        <div className="detail-intro"><div className={`type-icon large ${selected.kind}`}>{(() => { const Icon = kindIcons[selected.kind]; return <Icon size={21} />; })()}</div><div><h2>{titleOf(selected.content, selected.kind)}</h2><span>{kindLabels[selected.kind]}<span className="subheading-dot">·</span>{relativeTime(selected.updatedAt)}</span></div><button className={`icon-button detail-pin ${selected.pinned ? 'is-pinned' : ''}`} aria-label={selected.pinned ? '取消详情置顶' : '置顶当前记录'} onClick={() => void run(() => bridge.pin(selected.id))}><Pin size={16} fill={selected.pinned ? 'currentColor' : 'none'} /></button></div>
        <div className="detail-tabs"><button className={detailTab === 'original' ? 'active' : ''} onClick={() => setDetailTab('original')}>原始内容</button><button className={detailTab === 'translation' ? 'active' : ''} onClick={() => setDetailTab('translation')}><Sparkles size={13} /> AI 翻译{selected.translation && <span className="translation-dot" />}</button></div>
        <div className="detail-scroll">{detailTab === 'original' ? <div className={`detail-content ${selected.kind === 'code' || selected.kind === 'path' ? 'monospace' : ''}`}>{selected.kind === 'image' && selected.image ? <button className="detail-image" onClick={() => void run(async () => setImagePreview(await bridge.getImage(selected.id)))} aria-label="查看原图"><img src={selected.image.thumbnail} alt="剪贴板图片预览" /><span><Maximize2 size={13} /> 查看原图</span></button> : <div className="original-text" data-testid="original-content">{selected.content}</div>}</div> : <div className="translation-result">{translatingId === selected.id ? <div className="translation-placeholder"><div className="ai-orb"><Sparkles size={26} className="pulse" /></div><h3>让文字跨越语言…</h3><p>正在请求你配置的 AI 服务</p></div> : selected.translation ? <><div className="translation-result-label"><span><CheckCheck size={14} />{LANGUAGES[selected.translation.language]} · {selected.translation.provider === 'local' ? '本地词库' : 'AI 翻译'}</span><button className="icon-button" aria-label="复制译文" onClick={() => void run(() => bridge.copyTranslation(selected.id), '译文已复制')}><Copy size={15} /></button></div><div className="translated-text" data-testid="translated-content">{selected.translation.text}</div></> : <div className="translation-placeholder"><div className="ai-orb"><Sparkles size={26} /></div><h3>好的表达，不止一种语言</h3><p>{selected.kind === 'image' ? '图片暂不支持文字识别。\n选择一段文字，试试 AI 翻译。' : '选择目标语言，让 AI 帮你\n准确传递每一句话。'}</p></div>}</div>}
          <div className="entry-metadata"><div><span>创建时间</span><span>{new Date(selected.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span></div><div><span>{selected.kind === 'image' ? '图片大小' : '内容长度'}</span><span>{selected.image ? `${selected.image.width} × ${selected.image.height} · ${(selected.image.bytes / 1024).toFixed(0)} KB` : `${selected.content.length.toLocaleString()} 个字符`}</span></div><div><label htmlFor="entry-category">收纳到分类</label><select id="entry-category" value={selected.categoryId || ''} onChange={event => void run(() => bridge.assignCategory(selected.id, event.target.value || null))}><option value="">未分类</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></div>
          <div className="ai-box"><div className="ai-box-heading"><span><Sparkles size={15} /> AI 翻译</span><button className="icon-button" aria-label="设置 AI 翻译" onClick={() => setSettingsTab('ai')}><Settings2 size={14} /></button></div><div className="language-row"><span>自动检测</span><ArrowRight size={14} /><select aria-label="翻译目标语言" value={language} onChange={event => setLanguage(event.target.value as Language)}>{Object.entries(LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div><button className="button translate-button" disabled={selected.kind === 'image' || Boolean(translatingId)} onClick={() => void translate()}>{translatingId === selected.id ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{translatingId === selected.id ? '正在翻译…' : selected.translation ? '重新翻译' : '翻译这段内容'}<ArrowRight size={14} /></button><p><ShieldCheck size={11} /> {selected.kind === 'image' ? '图片暂不支持 OCR 翻译' : '仅在你点击翻译时发送此条文字'}</p></div>
        </div><div className="detail-actions"><button className="button primary copy-primary" onClick={() => void run(() => bridge.copy(selected.id), '已复制到剪贴板')}><Copy size={16} />复制{selected.kind === 'image' ? '图片' : '内容'}<span>↵</span></button><button className="delete-button" aria-label="删除当前记录" title="删除当前记录" onClick={() => void run(() => bridge.remove(selected.id), '记录已删除')}><Trash2 size={17} /></button><p>复制后，返回原应用按 {bridge.platform === 'darwin' ? '⌘' : 'Ctrl'} + V 粘贴</p></div>
      </> : <div className="detail-empty"><div className="detail-empty-icon"><Clipboard size={26} strokeWidth={1.4} /></div><h3>每一段内容，都有自己的位置</h3><p>选择一条记录，查看完整内容、<br />管理分类，或使用 AI 翻译。</p><div className="detail-empty-feature"><ShieldCheck size={15} /> 你的内容始终由你掌控</div></div>}</aside>
    </div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <X size={17} /> : <Check size={17} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {categoryModal && <Modal title="给灵感一个分类" subtitle="把相关的内容，放在一起。" onClose={() => setCategoryModal(false)}><form onSubmit={event => { event.preventDefault(); void (async () => { try { await bridge.createCategory(categoryName); setCategoryModal(false); setCategoryName(''); notify('新分类已创建'); } catch (error) { setCategoryError(error instanceof Error ? error.message : '创建失败'); } })(); }}><div className="modal-body"><label className="field-label" htmlFor="category-name">分类名称</label><input id="category-name" autoFocus maxLength={24} placeholder="例如：工作灵感、常用资料…" value={categoryName} onChange={event => setCategoryName(event.target.value)} />{categoryError && <div role="alert" className="form-error">{categoryError}</div>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setCategoryModal(false)}>取消</button><button className="button primary" type="submit" disabled={!categoryName.trim()}><Plus size={15} /> 创建分类</button></div></form></Modal>}
    {clearModal && <Modal title="清理剪贴板历史？" subtitle="清理后无法恢复。置顶的内容可以继续保留。" onClose={() => setClearModal(false)}><div className="modal-body"><label className="checkbox-label"><input type="checkbox" checked={clearPinned} onChange={event => setClearPinned(event.target.checked)} />同时清理 {pinnedCount} 条置顶记录</label><p className="field-help">将删除 {clearPinned ? entries.length : entries.length - pinnedCount} 条记录及其图片文件。</p></div><div className="modal-footer"><button className="button secondary" onClick={() => setClearModal(false)}>取消</button><button className="button destructive" onClick={() => void run(async () => { await bridge.clear(clearPinned); setClearModal(false); }, '历史记录已清理')}>确认清理</button></div></Modal>}
    {deleteCategoryModal && <Modal title={`删除「${currentCategory?.name || '分类'}」？`} subtitle="分类内的历史记录会保留，并恢复为未分类。" onClose={() => setDeleteCategoryModal(false)}><div className="modal-footer"><button className="button secondary" onClick={() => setDeleteCategoryModal(false)}>取消</button><button className="button destructive" onClick={() => void run(async () => { if (currentCategory) await bridge.deleteCategory(currentCategory.id); changeFilter('all'); setDeleteCategoryModal(false); }, '分类已删除')}>删除分类</button></div></Modal>}
    {imagePreview && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片原图" onClick={() => setImagePreview(null)}><button className="lightbox-close" aria-label="关闭原图" onClick={() => setImagePreview(null)}><X size={24} /></button><img src={imagePreview} alt="剪贴板原图" onClick={event => event.stopPropagation()} /></div>}
  </div>;
}
