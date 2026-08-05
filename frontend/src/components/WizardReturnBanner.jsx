import { Link, useSearchParams } from 'react-router-dom';

/**
 * Shown when the user is sent to a tool page mid Company Operate wizard
 * (links use ?from=company-operate).
 */
export default function WizardReturnBanner() {
  const [params] = useSearchParams();
  const from = params.get('from');
  if (from !== 'company-operate') return null;

  return (
    <div
      role="navigation"
      aria-label="Return to Company Operate"
      style={{
        marginBottom: '1rem',
        padding: '0.65rem 0.9rem',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ fontSize: '0.9rem' }}>
        You opened this from the <strong>Company Operate</strong> Day&nbsp;0/Day&nbsp;1 wizard.
      </span>
      <Link
        to="/company-operate?resume=1"
        style={{
          padding: '0.4rem 0.85rem',
          borderRadius: 8,
          background: 'var(--accent)',
          color: '#fff',
          textDecoration: 'none',
          fontSize: '0.9rem',
          fontWeight: 600,
        }}
      >
        ← Back to wizard
      </Link>
    </div>
  );
}
