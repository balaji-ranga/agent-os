import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  buildOrgTree,
  flattenOrgTree,
  groupAgentsByDepartment,
  CEO_NODE_ID,
} from '../utils/orgHierarchy.js';

function DeptBadge({ department }) {
  if (!department) return null;
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '0.1rem 0.45rem',
        borderRadius: 999,
        border: '1px solid var(--border)',
        color: 'var(--muted)',
        marginLeft: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {department}
    </span>
  );
}

function AgentActions({ agent, onRemove, isCeo }) {
  if (isCeo) return null;
  return (
    <span style={{ marginLeft: '0.5rem', display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Link to={`/agents/${agent.id}/workspace`} style={{ fontSize: '0.85rem' }}>
        Workspace
      </Link>
      <Link
        to={`/agents/${agent.id}/chat`}
        style={{
          padding: '0.2rem 0.5rem',
          background: 'var(--accent)',
          color: '#fff',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
      >
        Chat
      </Link>
      {typeof onRemove === 'function' && !agent.is_coo && (
        <button
          type="button"
          onClick={() => onRemove(agent.id)}
          style={{
            padding: '0.2rem 0.5rem',
            background: 'transparent',
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      )}
    </span>
  );
}

/** Recursive graph card with children in a horizontal row. */
function GraphCard({ node, onRemove }) {
  const kids = node.children || [];
  return (
    <div className="org-graph-branch">
      <div className={`org-graph-card${node.isCeo ? ' org-graph-card-ceo' : ''}${node.is_coo ? ' org-graph-card-coo' : ''}`}>
        <div className="org-graph-card-name">{node.name}</div>
        {node.role && <div className="org-graph-card-role">{node.role}</div>}
        {node.department && <div className="org-graph-card-dept">{node.department}</div>}
        {!node.isCeo && (
          <div className="org-graph-card-actions">
            <AgentActions agent={node} onRemove={onRemove} />
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <>
          <div className="org-graph-vline" aria-hidden />
          <div className="org-graph-children">
            {kids.map((c) => (
              <div key={c.id} className="org-graph-child-wrap">
                <div className="org-graph-hconnector" aria-hidden />
                <GraphCard node={c} onRemove={onRemove} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Org structure viewer: List | Graph, optional group-by-department.
 */
export default function OrgChart({ agents = [], onRemove }) {
  const [view, setView] = useState('list');
  const [groupByDept, setGroupByDept] = useState(false);

  const tree = useMemo(() => buildOrgTree(agents), [agents]);
  const deptGroups = useMemo(() => groupAgentsByDepartment(agents), [agents]);

  const toggleBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setView(id)}
      style={{
        padding: '0.35rem 0.75rem',
        borderRadius: 6,
        border: `1px solid ${view === id ? 'var(--accent)' : 'var(--border)'}`,
        background: view === id ? 'var(--accent)' : 'transparent',
        color: view === id ? '#fff' : 'var(--text)',
        cursor: 'pointer',
        fontSize: '0.85rem',
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        {toggleBtn('list', 'List')}
        {toggleBtn('graph', 'Graph')}
        <label style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={groupByDept}
            onChange={(e) => setGroupByDept(e.target.checked)}
          />
          Group by department
        </label>
      </div>

      {groupByDept ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {deptGroups.map(({ department, members }) => (
            <details
              key={department}
              open
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '0.5rem 0.75rem',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 6 }}>
                {department}{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({members.length})</span>
              </summary>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0.25rem 0 0.5rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map((a) => (
                  <li key={a.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                    <span style={{ fontWeight: 500 }}>{a.name}</span>
                    {a.role && <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>({a.role})</span>}
                    {a.parent_id && (
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>→ reports to {a.parent_id}</span>
                    )}
                    <AgentActions agent={a} onRemove={onRemove} />
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '0.75rem 1rem',
              color: 'var(--muted)',
              fontSize: '0.85rem',
            }}
          >
            CEO (you) sits above all departments. Reporting lines still use each agent&apos;s Reports to field.
          </div>
        </div>
      ) : view === 'list' ? (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Render CEO once, then children recursively without nesting ListNode wrappers incorrectly */}
          <ListTreeRoot tree={tree} onRemove={onRemove} />
        </div>
      ) : (
        <div className="org-graph-scroll">
          <GraphCard node={tree} onRemove={onRemove} />
        </div>
      )}
    </div>
  );
}

function ListTreeRoot({ tree, onRemove }) {
  const rows = flattenOrgTree(tree).filter((n) => n.id !== CEO_NODE_ID || n.isCeo);
  // flatten includes root; render each row flat with indent (avoid nested ListNode duplicate children)
  return (
    <>
      {rows.map((node) => {
        const pad = Math.min(node.depth, 8) * 1.25;
        return (
          <div
            key={node.id}
            style={{
              padding: '0.75rem 1.25rem',
              paddingLeft: `${1.25 + pad}rem`,
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span
              style={{
                fontWeight: node.isCeo || node.is_coo ? 600 : 500,
                color: node.isCeo ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {node.isCeo ? `👤 ${node.name}` : node.name}
            </span>
            {node.role && <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>— {node.role}</span>}
            <DeptBadge department={node.department} />
            <AgentActions agent={node} onRemove={onRemove} isCeo={node.isCeo} />
          </div>
        );
      })}
    </>
  );
}
