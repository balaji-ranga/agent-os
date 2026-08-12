import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'agent-os-theme';

/** Built-in Day/Night plus advanced 3D themes (Profile → Appearance). */
export const THEME_OPTIONS = [
  {
    id: 'light',
    label: 'Day',
    blurb: 'Default light',
    tier: 'default',
    colorScheme: 'light',
  },
  {
    id: 'dark',
    label: 'Night',
    blurb: 'Default dark',
    tier: 'default',
    colorScheme: 'dark',
  },
  {
    id: 'aurora-glass',
    label: 'Aurora Glass',
    blurb: '3D glass · purple–pink glow',
    tier: 'advanced',
    colorScheme: 'dark',
  },
  {
    id: 'vivid-board',
    label: 'Vivid Board',
    blurb: '3D lift · colorful boards',
    tier: 'advanced',
    colorScheme: 'light',
  },
];

export const THEME_IDS = THEME_OPTIONS.map((t) => t.id);

const ThemeContext = createContext({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
  themeMeta: THEME_OPTIONS[0],
  isAdvancedTheme: false,
});

function normalizeTheme(value) {
  return THEME_IDS.includes(value) ? value : 'light';
}

function themeColorScheme(theme) {
  const meta = THEME_OPTIONS.find((t) => t.id === theme);
  return meta?.colorScheme === 'dark' ? 'dark' : 'light';
}

function readStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* ignore */
  }
  return 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  const id = normalizeTheme(theme);
  root.setAttribute('data-theme', id);
  root.style.colorScheme = themeColorScheme(id);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const initial =
      typeof document !== 'undefined'
        ? document.documentElement.getAttribute('data-theme') || readStoredTheme()
        : readStoredTheme();
    return normalizeTheme(initial);
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(normalizeTheme(next));
  }, []);

  /** Quick Day ↔ Night; advanced themes exit to Day. */
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'dark';
      return 'light';
    });
  }, []);

  const themeMeta = useMemo(
    () => THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0],
    [theme]
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      themeMeta,
      isAdvancedTheme: themeMeta.tier === 'advanced',
    }),
    [theme, setTheme, toggleTheme, themeMeta]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
