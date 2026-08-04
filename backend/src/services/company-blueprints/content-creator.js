/**
 * Content Creator / social media company blueprint (Phase C flagship).
 * Platforms: Facebook, Instagram, LinkedIn, YouTube.
 */
export const contentCreatorBlueprint = {
  id: 'content_creator',
  aliases: ['content_studio', 'youtube_creator', 'social_media', 'marketing_agency'],
  label: 'Content Creator (Social media)',
  description:
    'Generate, review, and prepare content for Facebook, Instagram, LinkedIn, and YouTube. Draft comment replies, manage a content pipeline, and summarize ops.',
  depth: 'deep',
  departments: [
    { name: 'Creative', purpose: 'Strategy, brand voice, and content planning.' },
    { name: 'Production', purpose: 'Generate images, video, and copy drafts.' },
    { name: 'Community', purpose: 'Comment drafts, engagement tone, escalation.' },
    { name: 'Channels', purpose: 'Per-platform publish checklists and Browser Session ops.' },
    { name: 'Operations', purpose: 'Pipeline status, approvals, weekly rollups.' },
  ],
  agents: [
    {
      name: 'Content Strategist',
      role: 'Plan themes, calendars, and campaign briefs',
      department: 'Creative',
      tools: ['learnings_summary', 'master_data_rag', 'notify_ceo', 'kanban_create_task'],
    },
    {
      name: 'Media Generator',
      role: 'Create image/video/copy drafts for posts',
      department: 'Production',
      tools: [
        'learnings_summary',
        'master_data_rag',
        'generate_image',
        'generate_video',
        'kanban_create_task',
        'notify_ceo',
      ],
    },
    {
      name: 'Content Reviewer',
      role: 'Review drafts against brand and policy before publish',
      department: 'Creative',
      tools: ['learnings_summary', 'master_data_rag', 'notify_ceo', 'kanban_move_status'],
    },
    {
      name: 'Community Manager',
      role: 'Draft replies to comments; escalate sensitive threads',
      department: 'Community',
      tools: ['learnings_summary', 'master_data_rag', 'notify_ceo', 'kanban_create_task', 'summarize_url'],
    },
    {
      name: 'Channel Publisher',
      role: 'Platform publish checklists and Browser Session assistance',
      department: 'Channels',
      tools: [
        'learnings_summary',
        'master_data_rag',
        'browse_task_start',
        'browse_task_status',
        'browse_recipe_list',
        'browse_recipe_run',
        'notify_ceo',
      ],
    },
    {
      name: 'Ops Reporter',
      role: 'Summarize pipeline and employee outcomes for the CEO',
      department: 'Operations',
      tools: ['learnings_summary', 'master_data_rag', 'kanban_create_task', 'notify_ceo'],
    },
  ],
  workflows: [
    'Brief → generate draft → human review → publish checklist (Browser Session) → log outcome',
    'Inbound comment triage → Community Manager drafts → CEO approve if policy requires → post/reply',
    'Weekly ops rollup: pipeline counts + blockers → notify CEO',
  ],
  channels: [
    'Connect Browser Session and log into Facebook / Instagram / LinkedIn / YouTube in Client Chrome.',
    'Add Replicate_BYOK under API Keys if video generation is required.',
    'Use Policies for public-post and comment-approval rules.',
    'Optional: WhatsApp Channels for CEO alerts on media-ready work.',
  ],
  knowledge_tables: [
    {
      name: 'social_accounts',
      description: 'Connected social handles and status (manual/Browser Session).',
      columns: ['platform', 'handle', 'status', 'notes'],
      seed_rows: [
        { platform: 'Facebook', handle: '', status: 'not_connected', notes: 'Log in via Browser Session' },
        { platform: 'Instagram', handle: '', status: 'not_connected', notes: '' },
        { platform: 'LinkedIn', handle: '', status: 'not_connected', notes: '' },
        { platform: 'YouTube', handle: '', status: 'not_connected', notes: '' },
      ],
    },
    {
      name: 'content_pipeline',
      description: 'Content items from idea to publish.',
      columns: ['title', 'platform', 'stage', 'owner', 'due_date', 'notes'],
      seed_rows: [
        {
          title: 'Example: welcome brand post',
          platform: 'Instagram',
          stage: 'idea',
          owner: 'Content Strategist',
          due_date: '',
          notes: 'Replace with your first real brief',
        },
      ],
    },
    {
      name: 'brand_voice',
      description: 'Tone, dos/donts, and must-include phrases.',
      columns: ['topic', 'guidance'],
      seed_rows: [
        { topic: 'tone', guidance: 'Clear, friendly, professional; avoid jargon and hype.' },
        { topic: 'claims', guidance: 'Do not invent product claims; use Master Data facts only.' },
      ],
    },
    {
      name: 'comment_playbook',
      description: 'How Community Manager drafts replies and escalates.',
      columns: ['situation', 'response_style', 'escalate'],
      seed_rows: [
        {
          situation: 'Positive feedback',
          response_style: 'Thank briefly; invite to follow or share',
          escalate: 'no',
        },
        {
          situation: 'Complaint / legal / PR risk',
          response_style: 'Acknowledge + offline path; do not argue',
          escalate: 'yes',
        },
      ],
    },
  ],
  sop_documents: [
    {
      title: 'SOP — Content review before publish',
      filename: 'sop-content-review.md',
      contentText: `# Content review before publish

1. Media Generator produces draft (copy + MEDIA assets).
2. Content Reviewer checks brand_voice and Policies.
3. If management style is **approval**, notify CEO and wait on Kanban.
4. Channel Publisher only runs publish checklist after review is complete.
5. Log outcome on content_pipeline (stage = published or rejected).
`,
    },
    {
      title: 'SOP — Comment handling',
      filename: 'sop-comment-handling.md',
      contentText: `# Comment handling (FB / IG / LI / YT)

1. Community Manager drafts replies using comment_playbook.
2. Never invent facts; use master_data_rag for product truth.
3. Escalate (notify_ceo) when escalate=yes or tone is hostile/legal.
4. Live posting uses Browser Session; do not claim automated API publish unless configured.
`,
    },
    {
      title: 'SOP — Channel publish checklist',
      filename: 'sop-channel-publish.md',
      contentText: `# Publish checklist per channel

**All platforms**
- Asset reviewed and approved
- Caption length and hashtags OK
- No secrets / PII leaks

**YouTube** — Title, description, thumbnail, playlist if needed  
**Instagram** — Aspect ratio, carousel order, first comment if used  
**LinkedIn** — Professional framing, no over-hashtagging  
**Facebook** — Link preview check

Prefer **Browser Session** recipes after login once.
`,
    },
    {
      title: 'SOP — Weekly social ops summary',
      filename: 'sop-weekly-summary.md',
      contentText: `# Weekly social ops summary

Ops Reporter every week:
1. Count content_pipeline by stage.
2. Note blockers (accounts not connected, missing keys).
3. Summarize CEO approvals pending.
4. notify_ceo with short rollup + links to Knowledge / Kanban.
`,
    },
  ],
  systems_recommended: [
    { id: 'browser_session', label: 'Browser Session (social logins)', path: '/browser-session' },
    { id: 'api_keys', label: 'API Keys (Replicate / BYOK)', path: '/api-keys' },
    { id: 'content_explorer', label: 'Content Explorer (media files)', path: '/content-explorer' },
    { id: 'policies', label: 'Policies (approval style)', path: '/policies' },
    { id: 'channels', label: 'Agent Channels (WhatsApp/Slack optional)', path: '/workspace' },
  ],
  policy_templates: {
    suggest: `## Management style: AI suggests
- AI employees draft content, comments, and checklists.
- Do not publish or reply publicly without CEO direction.
- Prefer notify_ceo and Kanban for handoffs.`,
    after_approval: `## Management style: AI executes after approval
- AI employees may prepare full drafts and MEDIA assets.
- Public posts and public comment replies require CEO approval (Kanban or explicit chat OK).
- Internal research and drafts may run without approval.
- Escalate PR/legal risk immediately via notify_ceo.`,
    autonomous: `## Management style: AI executes autonomously
- AI employees may complete drafts and run Browser Session publish checklists when accounts are connected.
- Still obey budgets, tool grants, and brand_voice.
- Escalate legal/PR risk before posting.
- Prefer logging outcomes to content_pipeline.`,
  },
};

export default contentCreatorBlueprint;
