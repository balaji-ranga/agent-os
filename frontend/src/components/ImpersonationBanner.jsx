import { useAuth } from '../context/AuthContext';
import { userRoleTitle } from '../utils/userRoleTitle.js';

export default function ImpersonationBanner() {
  const { impersonation, exitImpersonation, user } = useAuth();

  if (!impersonation) return null;

  return (
    <div className="impersonation-banner" role="status">
      <span>
        Viewing platform as <strong>{user?.name}</strong> ({userRoleTitle(user)})
        {' · '}
        Admin: {impersonation.admin_name || impersonation.admin_id}
      </span>
      <button type="button" className="impersonation-banner-exit" onClick={() => exitImpersonation()}>
        Exit user view
      </button>
    </div>
  );
}
