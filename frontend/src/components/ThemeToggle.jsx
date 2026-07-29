import { useTheme } from '../context/ThemeContext';

/** Compact sun/moon control for topbar / mobile chrome. */
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span aria-hidden>{isDark ? '☀' : '☾'}</span>
    </button>
  );
}
