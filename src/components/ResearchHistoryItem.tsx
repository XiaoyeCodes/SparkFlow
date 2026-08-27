import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import './ResearchHistoryItem.css';

type Props = {
  title: string;
  time: string;
  active: boolean;
  pinned: boolean;
  running: boolean;
  onOpen: () => void;
  onNew: () => void;
  onUpdate: (changes: { title?: string; pinned?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
};

export function ResearchHistoryItem({ title, time, active, pinned, running, onOpen, onNew, onUpdate, onDelete }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const reposition = () => setMenu(null);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!action) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input')?.select();
    return () => { dialog?.close(); triggerRef.current?.focus(); };
  }, [action]);

  const closeMenu = () => { setMenu(null); triggerRef.current?.focus(); };
  const openDialog = (next: 'rename' | 'delete') => {
    setMenu(null);
    setError('');
    setDraft(title);
    setAction(next);
  };
  const togglePin = async () => {
    setBusy(true);
    setError('');
    try {
      await onUpdate({ pinned: !pinned });
      closeMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : '置顶失败，请重试');
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'rename') await onUpdate({ title: draft.trim() });
      else await onDelete();
      setAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally { setBusy(false); }
  };
  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    if (event.key === 'Tab') { setMenu(null); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className={`research-history-item${active ? ' is-active' : ''}${menu ? ' is-menu-open' : ''}`}>
      <button type="button" className="research-history-open" onClick={onOpen} title={title} aria-current={active ? 'page' : undefined}>
        <span className="research-history-title">{title}</span>
        <span className="research-history-meta">
          {pinned ? <Pin size={11} aria-label="已置顶" /> : null}
          <span>{time}</span>
          {running ? <Loader2 size={11} className="animate-spin" aria-label="研究中" /> : null}
        </span>
      </button>
      <button ref={triggerRef} type="button" className="research-history-more" title="研究选项"
        aria-label={`研究选项：${title}`} aria-haspopup="menu" aria-expanded={Boolean(menu)}
        onClick={() => {
          if (menu) { closeMenu(); return; }
          const rect = triggerRef.current!.getBoundingClientRect();
          setError('');
          setMenu({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 212)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 218)) });
        }}>
        <MoreHorizontal size={17} />
      </button>
      {menu ? createPortal(
        <div ref={menuRef} role="menu" aria-label="研究选项" className="research-history-menu" style={menu} onKeyDown={menuKeys}>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { closeMenu(); onNew(); }}><Plus size={16} />新建研究</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => openDialog('rename')}><Pencil size={16} />重命名</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => void togglePin()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : pinned ? <PinOff size={16} /> : <Pin size={16} />}{pinned ? '取消置顶' : '置顶'}
          </button>
          <div role="separator" />
          <button type="button" role="menuitem" className="is-danger" disabled={busy} onClick={() => openDialog('delete')}><Trash2 size={16} />删除</button>
          {error ? <p role="alert">{error}</p> : null}
        </div>, document.body,
      ) : null}
      {action ? createPortal(
        <dialog ref={dialogRef} className="research-history-dialog" aria-label={action === 'rename' ? '重命名研究' : '删除研究'}
          onCancel={event => { event.preventDefault(); if (!busy) setAction(null); }}>
          <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
            <div className="research-history-dialog-heading">
              <h2>{action === 'rename' ? '重命名研究' : '删除研究？'}</h2>
              <button type="button" title="关闭" aria-label="关闭对话框" disabled={busy} onClick={() => setAction(null)}><X size={18} /></button>
            </div>
            {action === 'rename' ? (
              <label>研究名称<input autoFocus value={draft} maxLength={120} required disabled={busy} onChange={event => setDraft(event.target.value)} /></label>
            ) : (
              <p>{running ? '这项研究正在执行，请先停止研究后再删除。' : `删除“${title}”及其对话记录？此操作无法撤销。`}</p>
            )}
            {error ? <p role="alert" className="research-history-error">{error}</p> : null}
            <div className="research-history-dialog-actions">
              <button type="button" disabled={busy} autoFocus={action === 'delete'} onClick={() => setAction(null)}>取消</button>
              <button type="submit" className={action === 'delete' ? 'is-danger' : 'is-primary'}
                disabled={busy || (action === 'rename' ? !draft.trim() : running)}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : action === 'rename' ? <Check size={15} /> : <Trash2 size={15} />}
                {busy ? '处理中' : action === 'rename' ? '保存' : '删除'}
              </button>
            </div>
          </form>
        </dialog>, document.body,
      ) : null}
    </div>
  );
}
