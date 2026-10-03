import { THEME_OPTIONS, useTheme } from '../context/ThemeContext';

/**
 * Color theme grid for Profile (Day/Night + advanced themes).
 * Choice is stored in the browser (localStorage); no server round-trip.
 */
export default function ThemePicker({ className = '' }) {
  const { theme, setTheme } = useTheme();

  return (
    <section className={`theme-picker ${className}`.trim()} aria-labelledby="theme-picker-heading">
      <h2 id="theme-picker-heading" className="theme-picker-heading">
        Color theme
      </h2>
      <p className="theme-picker-help">
        Choose the color treatment within your selected design system. Saved in this browser.
      </p>
      <div className="theme-picker-grid" role="listbox" aria-label="Theme">
        {THEME_OPTIONS.map((opt) => {
          const selected = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`theme-picker-card${selected ? ' is-selected' : ''}`}
              data-theme-preview={opt.id}
              onClick={() => setTheme(opt.id)}
            >
              <span className="theme-picker-swatch" aria-hidden>
                <span className="theme-picker-swatch-nav" />
                <span className="theme-picker-swatch-main">
                  <span className="theme-picker-swatch-card" />
                  <span className="theme-picker-swatch-card" />
                </span>
              </span>
              <span className="theme-picker-meta">
                <span className="theme-picker-label">{opt.label}</span>
                <span className="theme-picker-blurb">{opt.blurb}</span>
                {opt.tier === 'advanced' ? (
                  <span className="theme-picker-badge">Advanced</span>
                ) : null}
              </span>
              {selected ? (
                <span className="theme-picker-check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
