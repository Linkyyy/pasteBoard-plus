import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, Copy, Image as ImageIcon, LayoutGrid, Pin, Search, Settings2, ShieldCheck, Trash2, X, ChevronRight, Link as LinkIcon, Type } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { bridge } from './bridge';
import { titleOf } from '../shared/classify';

export default function CompactBoard({ snapshot, onManage, onSettings, onError }: {
  snapshot: Snapshot; onManage(id?: string): void; onSettings(): void; onError(message: string): void;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [visible, setVisible] = useState(50);
  const [focused, setFocused] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const records = useMemo(() => snapshot.entries.filter(entry => entry.kind !== 'path'
    && (tab === 'all' || (tab === 'pinned' ? entry.pinned : entry.kind === 'image'))
    && `${entry.content} ${entry.translation?.text || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [snapshot.entries, tab, query]);
  useEffect(() => { setVisible(50); setFocused(0); }, [query, tab]);
  useEffect(() => { document.querySelector(`[data-clipboard-index="${focused}"]`)?.scrollIntoView({ block: 'nearest' }); }, [focused]);
  async function action(callback: () => Promise<unknown>) {
    try { await callback(); } catch (error) { onError(error instanceof Error ? error.message : '操作失败'); }
  }
  async function copy(id: string) { await action(() => bridge.copy(id, true)); }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { if (query) setQuery(''); else void bridge.windowAction('hide'); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); onSettings(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.current?.focus(); return; }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        setFocused(index => Math.max(0, Math.min(visible - 1, records.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      }
      if (event.key === 'Enter' && records[focused] && (event.target as HTMLElement).tagName !== 'BUTTON') { event.preventDefault(); void copy(records[focused].id); }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  return <div className={`compact-stage ${bridge.isDesktop ? 'desktop' : 'preview'}`}><section className="compact-board" aria-label="剪贴板小窗口" data-testid="compact-board">
    <header className="compact-header"><div className="compact-brand"><img src="./icon.svg" alt="" /><h1>剪贴板</h1><span>Plus</span></div><div className="compact-header-actions"><button onClick={() => onManage()} aria-label="管理记录" title="管理记录"><LayoutGrid size={16} /></button><button onClick={onSettings} aria-label="打开设置" title="设置"><Settings2 size={16} /></button><button onClick={() => void bridge.windowAction('hide')} aria-label="收起剪贴板"><X size={17} /></button></div></header>
    <div className="compact-search"><Search size={15} /><input ref={search} aria-label="搜索剪贴板" placeholder="搜索剪贴板历史…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="清除关键词"><X size={13} /></button>}</div>
    <div className="compact-tabs"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部</button><button className={tab === 'pinned' ? 'active' : ''} onClick={() => setTab('pinned')}>置顶</button><button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>图片</button><span>{records.length} 条</span></div>
    {snapshot.warning && <div className="compact-warning" role="alert">{snapshot.warning}</div>}
    <div className="compact-records">{records.length ? records.slice(0, visible).map((entry, index) => {
      const Icon = entry.kind === 'image' ? ImageIcon : entry.kind === 'url' ? LinkIcon : Type;
      return <article className={`compact-record ${focused === index ? 'focused' : ''}`} key={entry.id} data-testid="compact-record" data-clipboard-index={index}>
        <button className="compact-record-body" onFocus={() => setFocused(index)} onClick={() => void copy(entry.id)} aria-label={`复制：${titleOf(entry.content, entry.kind)}`}>
          {entry.image ? <img className="compact-image" src={entry.image.thumbnail} alt="剪贴板图片" /> : <p>{entry.content}</p>}
          <span className="compact-record-meta"><Icon size={11} />{entry.kind === 'image' ? '图片' : entry.kind === 'url' ? '链接' : '文本'}<span>·</span>{new Date(entry.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}{entry.pinned && <Pin size={10} fill="currentColor" />}<Copy size={12} className="compact-copy-symbol" /></span>
        </button><div className="compact-record-actions"><button aria-label={entry.pinned ? '取消置顶' : '置顶'} onClick={() => void action(() => bridge.pin(entry.id))}><Pin size={12} fill={entry.pinned ? 'currentColor' : 'none'} /></button><button aria-label="详情与翻译" onClick={() => onManage(entry.id)}><ChevronRight size={14} /></button><button aria-label="删除记录" onClick={() => void action(() => bridge.remove(entry.id))}><Trash2 size={12} /></button></div>
      </article>;
    }) : <div className="compact-empty"><div><Clipboard size={32} strokeWidth={1.3} /></div><h2>{query ? '没有匹配的记录' : tab === 'image' && !snapshot.settings.captureImages ? '图片记录尚未开启' : '复制的内容，会留在这里'}</h2><p>{tab === 'image' && !snapshot.settings.captureImages ? '在设置中开启后，即可记录新复制的图片。' : '文字和链接自动留存，点击一条即可复制。'}</p>{tab === 'image' && !snapshot.settings.captureImages && <button className="button secondary" onClick={onSettings}>打开图片记录设置</button>}{!bridge.isDesktop && !snapshot.entries.length && <button className="button primary" onClick={() => void action(() => bridge.loadExamples!())}>体验示例</button>}</div>}
      {records.length > visible && <button className="compact-load" onClick={() => setVisible(value => value + 50)}>加载更早的记录 · 还有 {records.length - visible} 条</button>}
    </div>
    <footer className="compact-footer"><span><ShieldCheck size={11} />{snapshot.settings.historyLimit === 0 ? '历史无限条' : `容量 ${snapshot.settings.historyLimit} 条`}</span><button onClick={() => void action(() => bridge.saveSettings({ ...snapshot.settings, captureEnabled: !snapshot.settings.captureEnabled }))}><i className={snapshot.settings.captureEnabled ? 'active' : ''} />{snapshot.settings.captureEnabled ? '正在记录' : '已暂停'}</button><button onClick={() => onManage()}>管理 <ChevronRight size={12} /></button></footer>
    {!bridge.isDesktop && <div className="compact-preview-label">浏览器预览 · 系统剪贴板与快捷键请使用桌面版</div>}
  </section></div>;
}
