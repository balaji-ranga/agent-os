import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export default function ProfileMenu({ user, logout, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-menu-btn"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        title={user?.name || 'Profile'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="profile-menu-avatar" aria-hidden>
          {initialsFromName(user?.name)}
        </span>
      </button>
      {open && (
        <div className="profile-menu-dropdown" role="menu">
          <div className="profile-menu-meta">
            <div className="profile-menu-meta-name">{user?.name || 'User'}</div>
            <div className="profile-menu-meta-role">{user?.role || ''}</div>
          </div>
          <NavLink
            to="/profile"
            role="menuitem"
            className="profile-menu-item"
            onClick={() => {
              close();
              onNavigate?.();
            }}
          >
            Edit profile
          </NavLink>
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item danger"
            onClick={() => {
              close();
              logout();
            }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
