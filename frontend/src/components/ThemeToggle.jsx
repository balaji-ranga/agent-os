import { useTheme } from '../context/ThemeContext';

/** Compact Day/Night control for topbar / mobile chrome. Advanced themes: Profile → Appearance. */
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme, themeMeta, isAdvancedTheme } = useTheme();
  const prefersDarkChrome = themeMeta?.colorScheme === 'dark';
  const title = isAdvancedTheme
    ? `${themeMeta.label} (click for Day/Night)`
    : prefersDarkChrome
      ? 'Switch to Day theme'
      : 'Switch to Night theme';
  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={toggleTheme}
      title={title}
      aria-label={title}
      data-theme-active={theme}
    >
      <span aria-hidden>{prefersDarkChrome ? '☀' : '☾'}</span>
    </button>
  );
}
