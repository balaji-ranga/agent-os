import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

export const DESIGN_SYSTEM_OPTIONS = [
  {
    id: 'classic',
    label: 'Classic Flolah',
    blurb: 'The current familiar Flolah workspace and navigation.',
  },
  {
    id: 'immersive',
    label: 'Immersive Command Space',
    blurb: 'A spatial, high-depth command experience using the same Flolah capabilities.',
  },
];

export const DESIGN_SYSTEM_IDS = DESIGN_SYSTEM_OPTIONS.map((option) => option.id);

export function normalizeDesignSystem(value) {
  return DESIGN_SYSTEM_IDS.includes(value) ? value : 'classic';
}

const DesignSystemContext = createContext({
  designSystem: 'classic',
  setDesignSystem: () => {},
  isImmersive: false,
});

export function DesignSystemProvider({ children }) {
  const { user } = useAuth();
  const [designSystem, setDesignSystemState] = useState(() =>
    normalizeDesignSystem(user?.ui_design_system)
  );

  useEffect(() => {
    setDesignSystemState(normalizeDesignSystem(user?.ui_design_system));
  }, [user?.id, user?.ui_design_system]);

  useEffect(() => {
    document.documentElement.setAttribute('data-design-system', designSystem);
  }, [designSystem]);

  const setDesignSystem = useCallback((next) => {
    setDesignSystemState(normalizeDesignSystem(next));
  }, []);

  const value = useMemo(
    () => ({
      designSystem,
      setDesignSystem,
      isImmersive: designSystem === 'immersive',
    }),
    [designSystem, setDesignSystem]
  );

  return <DesignSystemContext.Provider value={value}>{children}</DesignSystemContext.Provider>;
}

export function useDesignSystem() {
  return useContext(DesignSystemContext);
}
