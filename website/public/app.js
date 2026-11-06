const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('#site-nav');
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? '收起导航' : '打开导航');
  navigation.classList.toggle('is-open', expanded);
});
navigation.addEventListener('click', event => {
  if (!event.target.closest('a')) return;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', '打开导航');
  navigation.classList.remove('is-open');
});

const input = document.querySelector('#demo-input');
const board = document.querySelector('#demo-board');
const toggle = document.querySelector('#demo-toggle');
const translation = document.querySelector('#demo-translation');
const translateButton = document.querySelector('#demo-translate');
const toast = document.querySelector('.demo-toast');
let toastTimer;
function showBoard(visible) {
  board.hidden = !visible;
  toggle.setAttribute('aria-expanded', String(visible));
}
// This demo touches only its own textarea, never the visitor's clipboard.
// Keep the textarea focus/caret while clicking a demo record with the mouse.
document.querySelector('.demo-workspace').addEventListener('mousedown', event => {
  if (event.target.closest('button') && document.activeElement === input) event.preventDefault();
});
toggle.addEventListener('click', () => showBoard(board.hidden));
document.querySelector('.demo-close').addEventListener('click', () => showBoard(false));
input.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') { event.preventDefault(); showBoard(board.hidden); }
  if (event.key === 'Escape') showBoard(false);
});
document.querySelectorAll('.demo-paste').forEach(button => button.addEventListener('click', () => {
  input.setRangeText(button.dataset.content, input.selectionStart, input.selectionEnd, 'end');
  input.focus({ preventScroll: true });
  input.dispatchEvent(new Event('input', { bubbles: true }));
  showBoard(false);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}));
translateButton.addEventListener('click', () => {
  translation.hidden = !translation.hidden;
  translateButton.setAttribute('aria-expanded', String(!translation.hidden));
});
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
  document.querySelectorAll('[data-entry]').forEach(entry => {
    entry.hidden = button.dataset.tab === 'pinned' ? !entry.dataset.pinned : button.dataset.tab === 'translated' ? entry.dataset.entry !== 'bread' : false;
  });
  if (button.dataset.tab === 'translated') { translation.hidden = false; translateButton.setAttribute('aria-expanded', 'true'); }
}));
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  const japanese = button.dataset.language === 'ja';
  document.querySelectorAll('[data-language]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  document.querySelector('#dictionary-language').textContent = japanese ? '日本語' : '简体中文';
  document.querySelector('#dictionary-word').textContent = japanese ? 'パン' : '面包';
  document.querySelector('#dictionary-reading').textContent = japanese ? '同一个词，换一种语言也能随手找到。' : '日常食物，也可以是下一段故事的开始。';
}));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    menuButton.click(); menuButton.focus();
  }
});
