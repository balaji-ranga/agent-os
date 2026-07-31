import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  buildOrgTree,
  flattenOrgTree,
  groupAgentsByDepartment,
  mergeAgentsWithLeafMembers,
  CEO_NODE_ID,
} from '../utils/orgHierarchy.js';

function LeafBadge({ kind }) {
  if (!kind) return null;
  return (
    <span
      className="org-leaf-badge"
      title="External / published A2A agent — leaf member, cannot manage others"
    >
      {kind === 'a2a_publish' ? 'A2A' : 'External'}
    </span>
  );
}

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

function AgentActions({ agent, onRemove, onRemoveLeaf, isCeo }) {
  if (isCeo) return null;
  if (agent._leaf) {
    const manageTo = agent._kind === 'a2a_publish' ? '/agent-exchange' : '/integrations/external-agents';
    const manageLabel = agent._kind === 'a2a_publish' ? 'AgentExchange' : 'External Agents';
    return (
      <span style={{ marginLeft: '0.5rem', display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
          reports to {agent.parent_id || 'COO'} · manage on{' '}
          <Link to={manageTo} style={{ fontSize: '0.75rem' }}>
            {manageLabel}
          </Link>
        </span>
        {typeof onRemoveLeaf === 'function' && (
          <button
            type="button"
            onClick={() => onRemoveLeaf(agent.id)}
            title="Remove from org chart only — does not delete the agent"
            style={{
              padding: '0.2rem 0.5rem',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Remove from org
          </button>
        )}
      </span>
    );
  }
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
      <Link
        to={`/agents/${agent.id}/virtual-room`}
        style={{
          padding: '0.2rem 0.5rem',
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
        title="Open 3D Virtual Room"
      >
        Virtual Room
      </Link>
      <Link
        to={`/agents/${agent.id}/channels`}
        style={{
          padding: '0.2rem 0.5rem',
          background: 'transparent',
          color: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
        title="Slack / WhatsApp channels"
      >
        Channels
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
function GraphCard({ node, onRemove, onRemoveLeaf }) {
  const kids = node.children || [];
  const leafClass = node._leaf ? ' org-graph-card-leaf' : '';
  return (
    <div className="org-graph-branch">
      <div
        className={`org-graph-card${node.isCeo ? ' org-graph-card-ceo' : ''}${node.is_coo ? ' org-graph-card-coo' : ''}${leafClass}`}
      >
        <div className="org-graph-card-name">
          {node.name}
          {node._leaf && <LeafBadge kind={node._kind} />}
        </div>
        {node.role && <div className="org-graph-card-role">{node.role}</div>}
        {node.department && <div className="org-graph-card-dept">{node.department}</div>}
        {!node.isCeo && (
          <div className="org-graph-card-actions">
            <AgentActions agent={node} onRemove={onRemove} onRemoveLeaf={onRemoveLeaf} />
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
                <GraphCard node={c} onRemove={onRemove} onRemoveLeaf={onRemoveLeaf} />
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
 * Merges external / published-A2A leaf members under their reports-to parent.
 */
export default function OrgChart({ agents = [], onRemove }) {
  const [view, setView] = useState('list');
  const [groupByDept, setGroupByDept] = useState(false);
  const [leafMembers, setLeafMembers] = useState([]);
  const [leafError, setLeafError] = useState(null);

  const loadLeafMembers = () => {
    api
      .orgMembers()
      .then((r) => setLeafMembers(r.members || []))
      .catch(() => setLeafMembers([]));
  };

  useEffect(() => {
    let cancelled = false;
    api
      .orgMembers()
      .then((r) => {
        if (!cancelled) setLeafMembers(r.members || []);
      })
      .catch(() => {
        if (!cancelled) setLeafMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const removeLeaf = async (memberId) => {
    if (
      !window.confirm(
        'Remove this agent from the org chart? The External / A2A agent itself is not deleted. Sync org when you want AGENTS.md updated.'
      )
    ) {
      return;
    }
    setLeafError(null);
    try {
      await api.orgMemberDelete(memberId);
      setLeafMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e) {
      setLeafError(e?.message || 'Failed to remove from org');
      loadLeafMembers();
    }
  };

  const chartAgents = useMemo(
    () => mergeAgentsWithLeafMembers(agents, leafMembers),
    [agents, leafMembers]
  );
  const tree = useMemo(() => buildOrgTree(chartAgents), [chartAgents]);
  const deptGroups = useMemo(() => groupAgentsByDepartment(chartAgents), [chartAgents]);

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
      {leafError && (
        <p style={{ color: 'var(--danger, #c44)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          {leafError}
        </p>
      )}
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
                    {a._leaf && <LeafBadge kind={a._kind} />}
                    {a.role && <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>({a.role})</span>}
                    {a.parent_id && !a._leaf && (
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>→ reports to {a.parent_id}</span>
                    )}
                    <AgentActions agent={a} onRemove={onRemove} onRemoveLeaf={removeLeaf} />
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
            External / A2A leaf members hang under their reports-to parent and cannot manage others.
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
          <ListTreeRoot tree={tree} onRemove={onRemove} onRemoveLeaf={removeLeaf} />
        </div>
      ) : (
        <div className="org-graph-scroll">
          <GraphCard node={tree} onRemove={onRemove} onRemoveLeaf={removeLeaf} />
        </div>
      )}
    </div>
  );
}

function ListTreeRoot({ tree, onRemove, onRemoveLeaf }) {
  const rows = flattenOrgTree(tree).filter((n) => n.id !== CEO_NODE_ID || n.isCeo);
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
              opacity: node._leaf && node.raw?._enabled === false ? 0.6 : 1,
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
            {node._leaf && <LeafBadge kind={node._kind} />}
            {node.role && <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>— {node.role}</span>}
            <DeptBadge department={node.department} />
            <AgentActions
              agent={node}
              onRemove={onRemove}
              onRemoveLeaf={onRemoveLeaf}
              isCeo={node.isCeo}
            />
          </div>
        );
      })}
    </>
  );
}
