import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import {
  DESIGN_SYSTEM_OPTIONS,
  useDesignSystem,
} from '../context/DesignSystemContext';

export default function DesignSystemPicker() {
  const { reload } = useAuth();
  const { designSystem, setDesignSystem } = useDesignSystem();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const choose = async (next) => {
    if (busy || next === designSystem) return;
    const previous = designSystem;
    setBusy(next);
    setMessage('');
    setError('');
    setDesignSystem(next);
    try {
      await api.authUpdateProfile({ ui_design_system: next });
      await reload();
      setMessage(`${DESIGN_SYSTEM_OPTIONS.find((option) => option.id === next)?.label} enabled.`);
    } catch (e) {
      setDesignSystem(previous);
      setError(e?.message || 'Unable to save the design system.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="design-system-picker" aria-labelledby="design-system-picker-heading">
      <h2 id="design-system-picker-heading" className="theme-picker-heading">Design system</h2>
      <p className="theme-picker-help">
        Choose how Flolah is arranged and presented. This follows your profile across devices; all
        menus, permissions, data and capabilities remain the same.
      </p>
      <div className="design-system-picker-grid" role="listbox" aria-label="Design system">
        {DESIGN_SYSTEM_OPTIONS.map((option) => {
          const selected = designSystem === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`design-system-card${selected ? ' is-selected' : ''}`}
              data-design-preview={option.id}
              disabled={Boolean(busy)}
              onClick={() => choose(option.id)}
            >
              <span className="design-system-preview" aria-hidden>
                <span className="design-system-preview-nav" />
                <span className="design-system-preview-body">
                  <span className="design-system-preview-hero" />
                  <span className="design-system-preview-cards">
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
              </span>
              <span className="theme-picker-meta">
                <span className="theme-picker-label">{option.label}</span>
                <span className="theme-picker-blurb">{option.blurb}</span>
                {option.id === 'immersive' ? (
                  <span className="theme-picker-badge">New experience</span>
                ) : null}
              </span>
              {selected ? <span className="theme-picker-check" aria-hidden>✓</span> : null}
              {busy === option.id ? <span className="design-system-saving">Saving…</span> : null}
            </button>
          );
        })}
      </div>
      <div className="design-system-feedback" aria-live="polite">
        {message ? <span className="design-system-success">{message}</span> : null}
        {error ? <span className="design-system-error">{error}</span> : null}
      </div>
    </section>
  );
}
