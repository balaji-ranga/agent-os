import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphToFlow, workflowNodeTypes } from './WorkflowNodes.jsx';
import { formatStepIoFull } from '../../utils/workflowStepIo.js';

const STATUS_COLORS = {
  completed: '#16a34a',
  failed: '#dc2626',
  in_progress: '#2563eb',
  listening: '#0284c7',
  pending: '#94a3b8',
  skipped: '#a8a29e',
};

function MediaPreview({ value }) {
  if (!value || typeof value !== 'object') return null;
  const url = value.url || value.audioUrl;
  const kind = value.kind || (value.mimeType || '').split('/')[0];
  if (!url) return null;
  if (kind === 'audio' || (value.mimeType || '').startsWith('audio/')) {
    return <audio controls src={`/api${url.startsWith('/') ? url : `/${url}`}`} style={{ width: '100%', marginTop: 6 }} />;
  }
  if (kind === 'video' || (value.mimeType || '').startsWith('video/')) {
    return <video controls src={`/api${url.startsWith('/') ? url : `/${url}`}`} style={{ width: '100%', marginTop: 6 }} />;
  }
  return (
    <a href={`/api${url.startsWith('/') ? url : `/${url}`}`} target="_blank" rel="noreferrer">
      Open media
    </a>
  );
}

export default function WorkflowRunGraph({
  run,
  height = 420,
  fill = false,
  onRetryFromStep = null,
  retryBusy = false,
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const graphHeight = fill ? '100%' : height;

  const stepByNode = useMemo(() => {
    const map = {};
    for (const s of run?.steps || []) {
      const prev = map[s.node_id];
      if (!prev || (s.iteration || 1) >= (prev.iteration || 1)) map[s.node_id] = s;
    }
    return map;
  }, [run]);

  const baseGraph = run?.graph || { nodes: [], edges: [] };

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const flow = graphToFlow(baseGraph);
    const styled = flow.nodes.map((n) => {
      const step = stepByNode[n.id];
      const status = step?.status || 'pending';
      const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
      return {
        ...n,
        style: {
          ...(n.style || {}),
          boxShadow: selectedNodeId === n.id ? `0 0 0 2px ${color}` : undefined,
          opacity: step ? 1 : 0.55,
        },
        data: {
          ...n.data,
          label: `${n.data?.label || n.type}${step ? ` · ${status}` : ''}`,
        },
      };
    });
    setNodes(styled);
    setEdges(flow.edges || []);
  }, [baseGraph, stepByNode, selectedNodeId, setNodes, setEdges]);

  const selectedStep = selectedNodeId ? stepByNode[selectedNodeId] : null;
  const selectedGraphNode = (baseGraph.nodes || []).find((n) => n.id === selectedNodeId);

  const canRetryStep =
    typeof onRetryFromStep === 'function' &&
    selectedNodeId &&
    run &&
    ['failed', 'paused', 'running'].includes(run.status) &&
    selectedNodeId !== 'trigger-1' &&
    (selectedStep || selectedGraphNode);

  const ioSections = [];
  if (selectedStep?.input) {
    const s = formatStepIoFull(selectedStep.input, 'input');
    if (s) ioSections.push(...s.map((x) => ({ ...x, kind: 'input' })));
  }
  if (selectedStep?.output) {
    const s = formatStepIoFull(selectedStep.output, 'output');
    if (s) ioSections.push(...s.map((x) => ({ ...x, kind: 'output' })));
  }

  return (
    <div
      className={`wf-run-graph${fill ? ' wf-run-graph--fill' : ''}`}
      style={{
        display: 'flex',
        gap: 12,
        height: graphHeight,
        minHeight: fill ? 0 : height,
        border: fill ? 'none' : '1px solid var(--border)',
        borderRadius: fill ? 0 : 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, height: graphHeight, minHeight: fill ? 0 : undefined }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={workflowNodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <aside
        className="wf-run-graph-aside"
        style={{
          width: fill ? 380 : 320,
          maxWidth: fill ? '36%' : '42%',
          borderLeft: '1px solid var(--border)',
          padding: 12,
          overflow: 'auto',
          background: 'var(--surface)',
          fontSize: '0.82rem',
        }}
      >
        {!selectedNodeId && (
          <p style={{ color: 'var(--muted)' }}>
            Click a node to inspect I/O. Use <strong>Retry from this step</strong> to re-execute that node and continue.
          </p>
        )}
        {selectedNodeId && (
          <>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>{selectedNodeId}</h3>
            <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
              type: {selectedGraphNode?.type || selectedStep?.node_type || '—'} · status:{' '}
              {selectedStep?.status || 'not executed'}
            </div>
            {canRetryStep && (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="wf-btn"
                  disabled={retryBusy}
                  title="Reset this node and downstream, re-dispatch, set run to running"
                  onClick={() => onRetryFromStep(selectedNodeId)}
                >
                  {retryBusy ? 'Retrying…' : 'Retry from this step'}
                </button>
                {run.status === 'paused' && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '6px 0 0' }}>
                    Run is paused — this will resume it to <strong>running</strong>.
                  </p>
                )}
              </div>
            )}
            {selectedStep?.error_message && (
              <p style={{ color: 'var(--danger, #b91c1c)' }}>{selectedStep.error_message}</p>
            )}
            <div style={{ marginBottom: 8 }}>
              <strong>Timing</strong>
              <div>
                {selectedStep?.started_at || '—'} → {selectedStep?.completed_at || '—'}
              </div>
              {(selectedStep?.kanban_task_id || selectedStep?.delegation_task_id) && (
                <div style={{ marginTop: 4 }}>
                  kanban: {selectedStep.kanban_task_id || '—'} · delegation: {selectedStep.delegation_task_id || '—'}
                </div>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Node config</strong>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem', margin: '4px 0' }}>
                {JSON.stringify(selectedGraphNode?.data?.taskConfig || selectedGraphNode?.data || {}, null, 2).slice(0, 2500)}
              </pre>
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>I/O</strong>
              {!ioSections.length && <p style={{ color: 'var(--muted)' }}>No step I/O</p>}
              {ioSections.map((sec, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>
                    {sec.kind}: {sec.title}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem', margin: '2px 0' }}>{sec.body}</pre>
                </div>
              ))}
            </div>
            <MediaPreview value={selectedStep?.output?.audio} />
            <MediaPreview value={selectedStep?.output?.video} />
            <MediaPreview value={selectedStep?.output?.media} />
            <MediaPreview value={selectedStep?.output?.playback?.audio} />
            {run?.context?.workflow_variables && (
              <div style={{ marginTop: 8 }}>
                <strong>Workflow variables</strong>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>
                  {JSON.stringify(run.context.workflow_variables, null, 2).slice(0, 1500)}
                </pre>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
