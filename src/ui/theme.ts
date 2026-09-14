/**
 * Light/dark switching.
 *
 * All the colours are light-dark() pairs in the stylesheet, so the only thing
 * that has to change is `color-scheme` on the root element. Leaving the
 * data-theme attribute off keeps :root at `light dark`, which follows the OS.
 */

/**
 * Also read by the inline boot script in index.html, which applies a stored
 * choice before first paint so the other palette never flashes. Keep the two
 * in step.
 */
const KEY = 'seedforge:theme';

export type Theme = 'system' | 'light' | 'dark';

const ORDER: readonly Theme[] = ['system', 'light', 'dark'];

const FACE: Record<Theme, { icon: string; label: string }> = {
  system: { icon: '◐', label: 'System' },
  light: { icon: '☀', label: 'Light' },
  dark: { icon: '☾', label: 'Dark' },
};

/**
 * Storage can throw outright in a locked-down browser, and a stored value can
 * be anything, so both are treated as "no preference recorded".
 */
function load(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* private mode, blocked site data */
  }
  return 'system';
}

function save(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* the toggle still works for this page view */
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Wires the topbar button. Returns nothing: the theme lives on the root
 * element, which is the only thing anything else needs to read.
 */
export function initTheme(
  button: HTMLButtonElement,
  icon: HTMLElement,
  label: HTMLElement,
  onChange: () => void,
): void {
  let current = load();

  const paint = (): void => {
    const face = FACE[current];
    icon.textContent = face.icon;
    label.textContent = face.label;
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
    button.title = `Theme: ${face.label}. Click for ${FACE[next].label.toLowerCase()}.`;
    button.setAttribute('aria-label', button.title);
  };

  apply(current);
  paint();

  button.addEventListener('click', () => {
    current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
    apply(current);
    save(current);
    paint();
    onChange();
  });

  // On "System" the palette can also change without anyone touching the
  // button, when the OS flips between light and dark.
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (current === 'system') onChange();
    });
}
