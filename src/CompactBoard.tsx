import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Clipboard, Copy, Image as ImageIcon, LayoutGrid, Pin, Settings2, ShieldCheck, Trash2, X, Languages, LoaderCircle, MoreHorizontal, ChevronDown } from 'lucide-react';
import type { Language, Snapshot } from '../shared/types';
import { LANGUAGES } from '../shared/types';
import { bridge } from './bridge';
import { titleOf } from '../shared/classify';

export default function CompactBoard({ snapshot, onManage, onSettings, onError }: {
  snapshot: Snapshot; onManage(id?: string): void; onSettings(tab?: 'general' | 'ai'): void; onError(message: string): void;
}) {
  const [tab, setTab] = useState('all');
  const [visible, setVisible] = useState(40);
  const [focused, setFocused] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const records = useMemo(() => snapshot.entries.filter(entry => entry.kind !== 'path'
    && (tab === 'all' || (tab === 'pinned' ? entry.pinned : tab === 'translated' ? Boolean(entry.translation) : entry.kind === 'image')))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [snapshot.entries, tab]);
  useEffect(() => { setVisible(40); setFocused(0); }, [tab]);
  useEffect(() => { document.querySelector(`[data-clipboard-index="${focused}"]`)?.scrollIntoView({ block: 'nearest' }); }, [focused]);
  async function action(callback: () => Promise<unknown>) { try { await callback(); } catch (error) { onError(error instanceof Error ? error.message : '操作失败'); } }
  async function paste(id: string, translated = false) { await action(async () => { const result = await bridge.paste(id, translated); if (!result.pasted && !bridge.isDesktop) setNotice(result.message); }); }
  async function translate(id: string) {
    setBusy(id); setExpanded(id); setErrors(current => ({ ...current, [id]: '' }));
    try { await bridge.translate(id, snapshot.settings.targetLanguage); }
    catch (error) { setErrors(current => ({ ...current, [id]: error instanceof Error ? error.message : '翻译失败' })); }
    finally { setBusy(null); }
  }
  function cycleLanguage() {
    const languages: Language[] = ['zh-CN', 'en', 'ja'];
    const next = languages[(languages.indexOf(snapshot.settings.targetLanguage) + 1) % languages.length];
    void action(() => bridge.saveSettings({ ...snapshot.settings, targetLanguage: next }));
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { void bridge.windowAction('hide'); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); onSettings(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setFocused(index => Math.max(0, Math.min(visible - 1, records.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && records[focused] && (event.target as HTMLElement).tagName !== 'BUTTON') { event.preventDefault(); void paste(records[focused].id); }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  return <div className={`compact-stage ${bridge.isDesktop ? 'desktop' : 'preview'}`}><section className="compact-board fluent-board" aria-label="剪贴板小窗口" data-testid="compact-board" style={{ '--clip-font-size': `${snapshot.settings.fontSize}px` } as CSSProperties}>
    <header className="fluent-caption"><span>PasteBoard Plus</span><div><button onClick={() => onManage()} aria-label="管理记录" title="管理记录"><LayoutGrid size={16} /></button><button onClick={() => onSettings()} aria-label="打开设置" title="设置"><Settings2 size={16} /></button><button onClick={() => void bridge.windowAction('hide')} aria-label="收起剪贴板"><X size={19} /></button></div></header>
    <nav className="fluent-tabs" aria-label="剪贴板分类">{[{ id: 'all', label: '全部', Icon: Clipboard }, { id: 'pinned', label: '置顶', Icon: Pin }, { id: 'image', label: '图片', Icon: ImageIcon }, { id: 'translated', label: '译文', Icon: Languages }].map(({ id, label, Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-label={label} title={label}><Icon size={21} strokeWidth={1.5} /></button>)}<button className="fluent-target" onClick={cycleLanguage} aria-label="切换翻译目标语言" title="点击切换中文、英语、日语">{LANGUAGES[snapshot.settings.targetLanguage]}<ChevronDown size={12} /></button></nav>
    <div className="fluent-section-title"><h1>剪贴板</h1><button onClick={() => setClear(!clear)} disabled={!snapshot.entries.some(entry => !entry.pinned)}>全部清除</button></div>
    {clear && <div className="fluent-inline-confirm"><span>清除所有未置顶记录？</span><button onClick={() => setClear(false)}>取消</button><button onClick={() => void action(async () => { await bridge.clear(false); setClear(false); })}>确认清除</button></div>}
    {(snapshot.warning || snapshot.insertion?.message || notice) && <div className="compact-warning" role="status">{snapshot.warning || snapshot.insertion?.message || notice}</div>}
    <div className="compact-records fluent-records">{records.length ? records.slice(0, visible).map((entry, index) => <article className={`fluent-record ${focused === index ? 'selected' : ''}`} key={entry.id} data-testid="compact-record" data-clipboard-index={index}>
      <button className="fluent-record-body" onFocus={() => setFocused(index)} onClick={() => void paste(entry.id)} aria-label={`复制：${titleOf(entry.content, entry.kind)}`} title="点击粘贴到原输入框">
        {entry.image ? <img className="compact-image" src={entry.image.thumbnail} alt="剪贴板图片" /> : <p>{entry.content}</p>}
      </button>
      <div className="fluent-record-tools"><button aria-label="词条更多操作" onClick={() => setMenu(menu === entry.id ? null : entry.id)}><MoreHorizontal size={18} /></button></div>
      <div className="fluent-record-bottom"><span>{entry.kind === 'image' ? '图片' : entry.kind === 'url' ? '链接' : '文本'}</span><div>{entry.kind !== 'image' && <button className="quick-translate" aria-label={`翻译：${titleOf(entry.content, entry.kind)}`} onClick={() => void translate(entry.id)} disabled={Boolean(busy)} title={`翻译为${LANGUAGES[snapshot.settings.targetLanguage]}`}>{busy === entry.id ? <LoaderCircle size={14} className="spin" /> : <Languages size={15} />}翻译</button>}<button aria-label={entry.pinned ? '取消置顶' : '置顶'} title={entry.pinned ? '取消置顶' : '置顶'} onClick={() => void action(() => bridge.pin(entry.id))}><Pin size={16} fill={entry.pinned ? 'currentColor' : 'none'} /></button></div></div>
      {menu === entry.id && <div className="fluent-item-menu"><button onClick={() => { setMenu(null); onManage(entry.id); }}>查看与管理</button><button onClick={() => void action(async () => { await bridge.remove(entry.id); setMenu(null); })}><Trash2 size={14} /> 删除记录</button></div>}
      {expanded === entry.id && <div className="fluent-inline-translation" data-testid="inline-translation">{busy === entry.id ? <span>正在翻译…</span> : errors[entry.id] ? <><p role="alert">{errors[entry.id]}</p><button onClick={() => onSettings('ai')}>打开翻译设置</button></> : entry.translation ? <><div><Languages size={13} />{LANGUAGES[entry.translation.language]} · {entry.translation.provider === 'local' ? '本地词库' : 'AI 翻译'}</div><p>{entry.translation.text}</p><button onClick={() => void paste(entry.id, true)}><Copy size={14} />粘贴译文</button></> : null}</div>}
    </article>) : <div className="compact-empty"><div><Clipboard size={32} strokeWidth={1.3} /></div><h2>{tab === 'image' && !snapshot.settings.captureImages ? '图片记录尚未开启' : '这里会显示复制过的内容'}</h2><p>{tab === 'image' && !snapshot.settings.captureImages ? '可在设置中开启图片记录。' : '在输入框按快捷键唤出，点选词条即可粘贴。'}</p>{tab === 'image' && !snapshot.settings.captureImages && <button className="button secondary" onClick={() => onSettings()}>打开图片记录设置</button>}{!bridge.isDesktop && !snapshot.entries.length && <button className="button primary" onClick={() => void action(() => bridge.loadExamples!())}>体验示例</button>}</div>}
      {records.length > visible && <button className="compact-load" onClick={() => setVisible(value => value + 40)}>加载更早的记录 · 还有 {records.length - visible} 条</button>}
    </div>
    <footer className="compact-footer"><span><ShieldCheck size={12} />{snapshot.settings.historyLimit === 0 ? '历史无限条' : `容量 ${snapshot.settings.historyLimit} 条`}</span><button onClick={() => void action(() => bridge.saveSettings({ ...snapshot.settings, captureEnabled: !snapshot.settings.captureEnabled }))}><i className={snapshot.settings.captureEnabled ? 'active' : ''} />{snapshot.settings.captureEnabled ? '正在记录' : '已暂停'}</button><button aria-label="打开记录管理" onClick={() => onManage()}>管理记录</button></footer>
    {!bridge.isDesktop && <div className="compact-preview-label">浏览器预览 · 自动粘贴与保留焦点需 Windows 桌面版</div>}
  </section></div>;
}
