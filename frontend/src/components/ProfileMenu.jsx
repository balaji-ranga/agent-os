import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { userRoleTitle } from '../utils/userRoleTitle.js';
import RobotAvatar from './RobotAvatar.jsx';

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
  const { theme, toggleTheme } = useTheme();

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
  const isCeo = user?.role === 'ceo';

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
        {user?.profile_image ? (
          <RobotAvatar src={user.profile_image} name={user?.name} size={32} variant="user" />
        ) : (
          <span className="profile-menu-avatar" aria-hidden>
            {initialsFromName(user?.name)}
          </span>
        )}
      </button>
      {open && (
        <div className="profile-menu-dropdown" role="menu">
          <div className="profile-menu-meta">
            <div className="profile-menu-meta-row">
              <RobotAvatar src={user?.profile_image} name={user?.name} size={40} variant="user" />
              <div>
                <div className="profile-menu-meta-name">{user?.name || 'User'}</div>
                <div className="profile-menu-meta-role">{userRoleTitle(user)}</div>
              </div>
            </div>
          </div>
          {isCeo && (
            <NavLink
              to="/onboarding"
              role="menuitem"
              className="profile-menu-item"
              onClick={() => {
                close();
                onNavigate?.();
              }}
            >
              Onboarding
            </NavLink>
          )}
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
          {isCeo && (
            <>
              <div className="profile-menu-section" role="presentation">
                Help
              </div>
              <NavLink
                to="/video-tours"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => {
                  close();
                  onNavigate?.();
                }}
              >
                Video Tours
              </NavLink>
              <NavLink
                to="/agents/platformhelp/chat"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => {
                  close();
                  onNavigate?.();
                }}
              >
                Platform Help
              </NavLink>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item"
            onClick={() => {
              toggleTheme();
            }}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
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
