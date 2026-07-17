/**
 * Kille — DOM & presentation helpers.
 * Stateless UI utilities with no dependency on application state.
 */

/** Query a single element. */
export const $ = (sel) => document.querySelector(sel);

/** Query all matching elements as an array. */
export const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Escape a string for safe interpolation into HTML. */
export function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** First letter of a name, uppercased and HTML-escaped, for avatars. */
export function avatarInitial(name) {
  return escHtml(String(name || '').charAt(0).toUpperCase());
}

/** Format a score with an explicit leading sign for positives. */
export function formatScore(score) {
  if (score > 0) return `+${score}`;
  return String(score);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer = null;

/** Show a transient toast message at the bottom of the screen. */
export function showToast(message) {
  let toast = $('#app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('app-toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('app-toast--visible'), 3000);
}

// ─── Swipe to dismiss ─────────────────────────────────────────────────────────
/** Make a bottom-sheet element dismissable with a downward swipe. */
export function addSwipeToDismiss(sheetEl, closeFn) {
  let startY = 0;
  let startScrollTop = 0;

  sheetEl.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startScrollTop = sheetEl.scrollTop;
    sheetEl.style.transition = 'none';
  }, { passive: true });

  sheetEl.addEventListener('touchmove', (e) => {
    if (startScrollTop > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheetEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  sheetEl.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (startScrollTop === 0 && dy > 80) {
      sheetEl.style.transition = 'transform 200ms ease';
      sheetEl.style.transform = 'translateY(100%)';
      setTimeout(() => {
        sheetEl.style.transition = '';
        sheetEl.style.transform = '';
        closeFn(true);
      }, 200);
    } else {
      sheetEl.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      sheetEl.style.transform = '';
      sheetEl.addEventListener('transitionend', () => {
        sheetEl.style.transition = '';
      }, { once: true });
    }
  });
}
