/**
 * Built-in agent workflow templates (separate from imperative job-applicant pipeline).
 */

import {
  buildAnimationPlannerPrompt,
  classifyAnimationCatalog,
} from './avatar-animation-catalog.js';

export const JOB_APPLICANT_TEMPLATE_ID = 'template-job-applicant-pipeline';
export const JOB_APPLICANT_CHAT_PHRASE = 'run job applicant pipeline';
export const AVATAR_OUTBOUND_TEMPLATE_ID = 'template-avatar-outbound';
export const AVATAR_INBOUND_TEMPLATE_ID = 'template-avatar-inbound';

const PIPELINE_SCOPE = `Use the active job search profile (job_check_profile_active + job_search_profile_get).
Always pass ceo_user_id and profile_id in profile and job tool calls.
This is an automated pipeline step — work autonomously. Do NOT call job_run_workflow_now.`;

function agentNode(id, label, agentId, agentName, x, prompt, inputFromId = 'trigger-1', y = 120) {
  return {
    id,
    type: 'agent',
    position: { x, y },
    data: {
      label,
      agentId,
      agentName,
      prompt,
      inputBindings: [
        {
          id: 'prompt',
          label: 'Task / prompt',
          mode: 'dynamic',
          sourceNodeId: inputFromId,
          sourceOutputKey: 'text',
          value: '',
        },
      ],
      outputs: [{ id: 'text', label: 'Agent response' }],
    },
  };
}

const ELEVENLABS_KEY_REF = 'elevenlabs-key';

const FAST_TTS_CONFIG = {
  mode: 'tts',
  voiceId: '21m00Tcm4TlvDq8ikWAM',
  modelId: 'eleven_flash_v2_5',
  outputFormat: 'mp3_22050_32',
  apiKeyRef: ELEVENLABS_KEY_REF,
  speakClean: true,
};

const FAST_STT_CONFIG = {
  mode: 'stt',
  apiKeyRef: ELEVENLABS_KEY_REF,
};

function brainAnimationNode(id, x, y, catalog = [], idleClip = null) {
  const catalogText = JSON.stringify(catalog || [], null, 2);
  const classified = classifyAnimationCatalog(catalog);
  const preferredIdle = idleClip || classified.idle;
  return {
    id,
    type: 'brain',
    position: { x, y },
    data: {
      label: 'Animation + visemes',
      taskConfig: {
        modelSource: 'ollama',
        model: 'llama3.2',
        maxTokens: 700,
        systemPrompt: `${buildAnimationPlannerPrompt(catalog)}

Full catalog JSON:
${catalogText}

Preferred idle clip (must use unless missing from catalog): ${preferredIdle || 'null'}.
Defaults if unsure: idle=${preferredIdle || 'null'}, mouthClip=${classified.mouth || 'null'}.`,
      },
      inputBindings: [
        {
          id: 'userMessage',
          label: 'Agent reply',
          mode: 'dynamic',
          sourceNodeId: 'agent-1',
          sourceOutputKey: 'text',
          value: '',
        },
      ],
      outputs: [
        { id: 'text', label: 'Animation JSON' },
        { id: 'result', label: 'Result' },
      ],
    },
  };
}

function model3dSpeakNode(id, x, y, avatarId, audioSourceId, animSourceId) {
  return {
    id,
    type: 'model3d',
    position: { x, y },
    data: {
      label: '3D Model',
      taskConfig: { avatarId },
      inputBindings: [
        {
          id: 'audio',
          label: 'Audio',
          mode: 'dynamic',
          sourceNodeId: audioSourceId,
          sourceOutputKey: 'audio',
          value: '',
        },
        {
          id: 'animation',
          label: 'Animation',
          mode: 'dynamic',
          sourceNodeId: animSourceId,
          sourceOutputKey: 'text',
          value: '',
        },
        {
          id: 'text',
          label: 'Reply text (viseme hint)',
          mode: 'dynamic',
          sourceNodeId: 'agent-1',
          sourceOutputKey: 'text',
          value: '',
        },
        {
          id: 'avatarId',
          label: 'Avatar ID',
          mode: 'static',
          value: avatarId || '{{var.avatar_id}}',
        },
      ],
      outputs: [
        { id: 'playback', label: 'Playback' },
        { id: 'text', label: 'Text' },
      ],
    },
  };
}

/** Avatar speaks: agent → parallel(TTS + Brain anim/visemes) → merge → model3d */
export function buildAvatarOutboundGraph({
  agentId = '',
  agentName = 'Agent',
  avatarId = '',
  animationCatalog = [],
  idleClip = null,
} = {}) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 160 },
        data: {
          label: 'Start',
          triggerModes: ['manual', 'event', 'chat'],
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
        },
      },
      {
        ...agentNode(
          'agent-1',
          agentName || 'Agent',
          agentId,
          agentName,
          240,
          `CRITICAL — Virtual Room speech output rules:
- Output ONLY the words the avatar should speak aloud.
- Exactly 1-2 short conversational sentences.
- Do NOT use tools, read MEMORY/session history, or update Kanban.
- Do NOT narrate planning, guidelines, or system instructions.
- Do NOT mention that you are an avatar or following a prompt.
- Your entire message must be speakable dialogue only.

User message:
{{input}}`
        ),
      },
      {
        id: 'parallel-1',
        type: 'parallel',
        position: { x: 460, y: 160 },
        data: {
          label: 'TTS ∥ Animation',
          inputBindings: [],
          outputs: [{ id: 'parallel', label: 'Branches' }],
        },
      },
      {
        id: 'elevenlabs-1',
        type: 'elevenlabs',
        position: { x: 680, y: 60 },
        data: {
          label: 'ElevenLabs TTS (Flash)',
          taskConfig: { ...FAST_TTS_CONFIG },
          inputBindings: [
            {
              id: 'text',
              label: 'Text',
              mode: 'dynamic',
              sourceNodeId: 'agent-1',
              sourceOutputKey: 'text',
              value: '',
            },
          ],
          outputs: [
            { id: 'audio', label: 'Audio' },
            { id: 'text', label: 'Text' },
          ],
        },
      },
      brainAnimationNode('brain-1', 680, 260, animationCatalog, idleClip),
      {
        id: 'merge-1',
        type: 'merge',
        position: { x: 920, y: 160 },
        data: {
          label: 'Merge',
          inputBindings: [],
          outputs: [{ id: 'merged', label: 'Merged' }],
        },
      },
      model3dSpeakNode('model3d-1', 1120, 160, avatarId, 'elevenlabs-1', 'brain-1'),
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'agent-1' },
      { id: 'e2', source: 'agent-1', target: 'parallel-1' },
      { id: 'e3', source: 'parallel-1', target: 'elevenlabs-1' },
      { id: 'e4', source: 'parallel-1', target: 'brain-1' },
      { id: 'e5', source: 'elevenlabs-1', target: 'merge-1' },
      { id: 'e6', source: 'brain-1', target: 'merge-1' },
      { id: 'e7', source: 'merge-1', target: 'model3d-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.8 },
  };
}

/**
 * Avatar listens: STT → agent → parallel(TTS + Brain) → merge → model3d
 */
export function buildAvatarInboundGraph({
  agentId = '',
  agentName = 'Agent',
  avatarId = '',
  outboundWorkflowId = '',
  animationCatalog = [],
  idleClip = null,
} = {}) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 160 },
        data: {
          label: 'User audio',
          triggerModes: ['manual', 'event'],
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
        },
      },
      {
        id: 'elevenlabs-stt',
        type: 'elevenlabs',
        position: { x: 240, y: 160 },
        data: {
          label: 'ElevenLabs STT',
          taskConfig: { ...FAST_STT_CONFIG },
          inputBindings: [
            {
              id: 'audio',
              label: 'Audio',
              mode: 'dynamic',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'trigger_input',
              value: '',
            },
          ],
          outputs: [{ id: 'text', label: 'Transcript' }],
        },
      },
      {
        ...agentNode(
          'agent-1',
          agentName || 'Agent',
          agentId,
          agentName,
          460,
          `CRITICAL — Virtual Room speech output rules:
- Output ONLY the words the avatar should speak aloud.
- Exactly 1-2 short conversational sentences.
- Do NOT use tools, read MEMORY/session history, or update Kanban.
- Do NOT narrate planning, guidelines, or system instructions.
- Do NOT mention that you are an avatar or following a prompt.
- Your entire message must be speakable dialogue only.

User message:
{{input}}`,
          'elevenlabs-stt'
        ),
      },
      {
        id: 'parallel-1',
        type: 'parallel',
        position: { x: 680, y: 160 },
        data: {
          label: 'TTS ∥ Animation',
          inputBindings: [],
          outputs: [{ id: 'parallel', label: 'Branches' }],
        },
      },
      {
        id: 'elevenlabs-tts',
        type: 'elevenlabs',
        position: { x: 900, y: 60 },
        data: {
          label: 'ElevenLabs TTS (Flash)',
          taskConfig: { ...FAST_TTS_CONFIG },
          inputBindings: [
            {
              id: 'text',
              label: 'Text',
              mode: 'dynamic',
              sourceNodeId: 'agent-1',
              sourceOutputKey: 'text',
              value: '',
            },
          ],
          outputs: [
            { id: 'audio', label: 'Audio' },
            { id: 'text', label: 'Text' },
          ],
        },
      },
      brainAnimationNode('brain-1', 900, 260, animationCatalog, idleClip),
      {
        id: 'merge-1',
        type: 'merge',
        position: { x: 1140, y: 160 },
        data: {
          label: 'Merge',
          inputBindings: [],
          outputs: [{ id: 'merged', label: 'Merged' }],
        },
      },
      model3dSpeakNode('model3d-1', 1340, 160, avatarId, 'elevenlabs-tts', 'brain-1'),
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'elevenlabs-stt' },
      { id: 'e2', source: 'elevenlabs-stt', target: 'agent-1' },
      { id: 'e3', source: 'agent-1', target: 'parallel-1' },
      { id: 'e4', source: 'parallel-1', target: 'elevenlabs-tts' },
      { id: 'e5', source: 'parallel-1', target: 'brain-1' },
      { id: 'e6', source: 'elevenlabs-tts', target: 'merge-1' },
      { id: 'e7', source: 'brain-1', target: 'merge-1' },
      { id: 'e8', source: 'merge-1', target: 'model3d-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.75 },
    meta: { outboundWorkflowId: outboundWorkflowId || null },
  };
}

/** Linear job-applicant pipeline matching /job-workflows stage order (without CEO Kanban gate). */
export function buildJobApplicantPipelineGraph({
  scheduleCron = '0 * * * *',
  chatPhrase = JOB_APPLICANT_CHAT_PHRASE,
  triggerModes = ['manual', 'chat'],
} = {}) {
  const nodes = [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 40, y: 120 },
      data: {
        label: 'Start',
        triggerModes,
        scheduleCron: triggerModes.includes('schedule') ? scheduleCron : '',
        chatPhrase: triggerModes.includes('chat') ? chatPhrase : '',
        inputBindings: [],
        outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
      },
    },
    {
      ...agentNode(
        'agent-discovery',
        'Job Discovery',
        'jobdiscovery',
        'Job Discovery',
        260,
        `${PIPELINE_SCOPE}

Discover new jobs for the active profile. Use job_inventory_summary, browser (profile=openclaw), and jobs_append.
Report harvest count, appended count, and sample URLs.

{{input}}`
      ),
      position: { x: 260, y: 120 },
    },
    {
      ...agentNode(
        'agent-fitscorer',
        'Fit Scoring',
        'fitscorer',
        'Fit Scoring',
        480,
        `${PIPELINE_SCOPE}

Score all jobs with status "discovered". Use job_fit_score / jobs_update. Shortlist or skip per fit_threshold.
Report counts by status.

Prior step summary:
{{input}}`,
        'agent-discovery'
      ),
      position: { x: 480, y: 120 },
    },
    {
      ...agentNode(
        'agent-resumetailor',
        'Resume Tailoring',
        'resumetailor',
        'Resume Tailoring',
        700,
        `${PIPELINE_SCOPE}

Tailor materials for jobs with status "shortlisted". Update jobs to awaiting_approval.
Note: the imperative Job workflow submits CEO Kanban review here — approve jobs on Kanban before application.

Prior step summary:
{{input}}`,
        'agent-fitscorer'
      ),
      position: { x: 700, y: 120 },
    },
    {
      ...agentNode(
        'agent-application',
        'Application Agent',
        'applicationagent',
        'Application Agent',
        920,
        `${PIPELINE_SCOPE}

Apply only to jobs with status "approved". Follow submit_policy. Update job status to applied or failed.

Prior step summary:
{{input}}`,
        'agent-resumetailor'
      ),
      position: { x: 920, y: 120 },
    },
  ];

  return {
    nodes,
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'agent-discovery' },
      { id: 'e2', source: 'agent-discovery', target: 'agent-fitscorer' },
      { id: 'e3', source: 'agent-fitscorer', target: 'agent-resumetailor' },
      { id: 'e4', source: 'agent-resumetailor', target: 'agent-application' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

export function getWorkflowTemplates() {
  return [
    {
      id: JOB_APPLICANT_TEMPLATE_ID,
      name: 'Job Applicant Pipeline',
      description:
        'Mirrors Job workflows: Job Discovery → Fit Scoring → Resume Tailoring → Application Agent. Requires an active job profile. CEO Kanban approval after tailoring is handled outside this graph (same as Job workflows).',
      category: 'job',
      default_trigger_modes: ['manual', 'chat'],
      default_schedule_cron: '0 * * * *',
      default_chat_phrase: JOB_APPLICANT_CHAT_PHRASE,
      graph: buildJobApplicantPipelineGraph(),
    },
    {
      id: 'template-job-discovery-email',
      name: 'Job Discovery → Email',
      description: 'Job Discovery agent produces an email body → Send Email task (static To + dynamic body).',
      category: 'job',
      default_trigger_modes: ['manual', 'chat'],
      default_schedule_cron: '',
      default_chat_phrase: 'run job discovery email workflow',
      graph: null,
      seed_script: 'seed-sample-job-discovery-email-workflow.js',
    },
    {
      id: AVATAR_OUTBOUND_TEMPLATE_ID,
      name: 'Avatar outbound (speak)',
      description:
        'Agent reply → parallel Flash TTS + Brain animation/visemes → 3D Model playback.',
      category: 'avatar',
      default_trigger_modes: ['manual', 'event', 'chat'],
      default_schedule_cron: '',
      default_chat_phrase: 'avatar speak',
      graph: buildAvatarOutboundGraph({ agentId: '', agentName: 'Agent', avatarId: '' }),
    },
    {
      id: AVATAR_INBOUND_TEMPLATE_ID,
      name: 'Avatar inbound (listen)',
      description:
        'User audio → STT → Agent → parallel Flash TTS + Brain animation/visemes → 3D Model.',
      category: 'avatar',
      default_trigger_modes: ['manual', 'event'],
      default_schedule_cron: '',
      default_chat_phrase: '',
      graph: buildAvatarInboundGraph({
        agentId: '',
        agentName: 'Agent',
        avatarId: '',
        outboundWorkflowId: '',
      }),
    },
  ];
}

export function getWorkflowTemplate(templateId) {
  const templates = getWorkflowTemplates();
  const found = templates.find((t) => t.id === templateId);
  if (!found) return null;
  if (found.id === JOB_APPLICANT_TEMPLATE_ID) {
    return {
      ...found,
      graph: buildJobApplicantPipelineGraph({
        scheduleCron: found.default_schedule_cron,
        chatPhrase: found.default_chat_phrase,
        triggerModes: found.default_trigger_modes,
      }),
    };
  }
  return found;
}
