/**
 * FloLah Video Tours — UI walkthrough storyboards (nav highlight + pointer callouts).
 * Used by export-video-tours.js to render SVG slides → PNG → mp4.
 */
export const NAV_ITEMS = [
  'Dashboard',
  'Kanban',
  'Broadcast',
  'Master Data',
  'Content Explorer',
  'API Keys',
  'Policies',
  'Efficiency View',
  'Browser Session',
  'Workflows',
  '3D Avatars',
  'Published Scenes',
];

/** @typedef {{ nav?: string|null, scene: string, heading?: string, bullets?: string[], pointer?: {label: string, target?: string}|null, caption: string }} Slide */

/** @type {Record<string, Slide[]>} */
export const STORYBOARDS = {
  '01-vision-architecture': [
    { scene: 'hero', heading: 'FloLah', bullets: ['Automate · Innovate · Elevate', 'Your AI operating system'], caption: 'Welcome to FloLah — Automate, Innovate, Elevate.', pointer: null, nav: null },
    { scene: 'dashboard', nav: 'Dashboard', heading: 'Dashboard & org', bullets: ['Org chart of your agents', 'Chat is where work starts'], pointer: { label: 'Org chart', target: 'main' }, caption: 'You set purpose and goals; agents and workflows execute.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Agents & chat', bullets: ['Open any agent to chat', 'Attach files · grant tools'], pointer: { label: 'Agent chat', target: 'chat' }, caption: 'Architecture: Dashboard and org chart, COO for ops.' },
    { scene: 'workflows', nav: 'Workflows', heading: 'Workflow Builder', bullets: ['Create · publish · run', 'Automate durable processes'], pointer: { label: 'Open Workflows', target: 'nav' }, caption: 'Workflow Builder for automation.' },
    { scene: 'masterData', nav: 'Master Data', heading: 'Knowledge & tools', bullets: ['Master Data for RAG', 'API Keys for capabilities'], pointer: { label: 'Master Data', target: 'nav' }, caption: 'Master Data for knowledge, Tools and API Keys for capabilities.' },
    { scene: 'cta', nav: null, heading: 'Next: First login', bullets: ['Profile · MFA · Onboarding', 'Shape your org strategically'], pointer: { label: 'Continue playlist', target: 'main' }, caption: 'Start with Profile, then shape your org — or use Onboarding.' },
  ],
  '02-first-login-profile': [
    { scene: 'hero', heading: 'First login', bullets: ['Secure access', 'Set up your CEO profile'], caption: 'After register and login, complete MFA if prompted.', pointer: null, nav: null },
    { scene: 'profile', nav: null, heading: 'User menu → Profile', bullets: ['Click your avatar (top right)', 'Edit profile & preferences'], pointer: { label: 'User icon', target: 'avatar' }, caption: 'Open your user icon, then Edit profile.' },
    { scene: 'profile', nav: null, heading: 'API Keys & models', bullets: ['BYOK vault for providers', 'Pick chat provider + model'], pointer: { label: 'API Keys nav', target: 'nav' }, caption: 'Connect API Keys so agents can use your models and tools.' },
    { scene: 'onboarding', nav: null, heading: 'Onboarding Helper', bullets: ['User menu → Onboarding', 'Strategic org wizard'], pointer: { label: 'Onboarding', target: 'avatar' }, caption: 'Onboarding Helper lives under the same user menu when you want a guided org setup.' },
    { scene: 'cta', nav: null, heading: 'You are ready', bullets: ['Dashboard next', 'Meet your agents'], pointer: null, caption: 'Then open Dashboard to meet your org.' },
  ],
  '03-org-dashboard-agents': [
    { scene: 'dashboard', nav: 'Dashboard', heading: 'Your Dashboard is the org', bullets: ['Departments & agents on the chart'], pointer: { label: 'Org chart', target: 'main' }, caption: 'Your Dashboard is the org. Departments and agents appear on the chart.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Open an agent chat', bullets: ['Click COO or any agent', 'Chat pane opens on the right'], pointer: { label: 'Open COO', target: 'chat' }, caption: 'Open an agent to chat, attach files, and use tools you granted.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Attachments', bullets: ['Paperclip in chat', 'Files feed Master Data / inbound'], pointer: { label: 'Attach files', target: 'chat' }, caption: 'Workspace markdown and templates live here — Apply and Publish carefully.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Resync', bullets: ['Refresh ORG.md & AGENTS.md', 'Keep tenants aligned'], pointer: { label: 'Resync', target: 'main' }, caption: 'Resync refreshes ORG and AGENTS files.' },
    { scene: 'cta', nav: 'Kanban', heading: 'Make work durable', bullets: ['Chat starts work', 'Kanban & workflows persist it'], pointer: { label: 'Kanban', target: 'nav' }, caption: 'Chat is where work starts; Kanban and workflows are where it becomes durable.' },
  ],
  '04-coo-kanban-standups': [
    { scene: 'orgChat', nav: 'Dashboard', heading: 'COO is ops lead', bullets: ['Delegate specialty work', 'Standups & status'], pointer: { label: 'COO chat', target: 'chat' }, caption: 'The COO coordinates day-to-day ops.' },
    { scene: 'kanban', nav: 'Kanban', heading: 'Kanban board', bullets: ['Agent-owned cards', 'Track status of work'], pointer: { label: 'Open Kanban', target: 'nav' }, caption: 'Kanban holds durable tasks your agents own.' },
    { scene: 'kanban', nav: 'Kanban', heading: 'Standups', bullets: ['Ask COO for standup', 'Fan-out to the team'], pointer: { label: 'Standup flow', target: 'main' }, caption: 'Run standups through the COO to collect status from the team.' },
    { scene: 'kanban', nav: 'Broadcast', heading: 'Broadcast', bullets: ['Notify specialists by intent', 'Paced fan-out'], pointer: { label: 'Broadcast', target: 'nav' }, caption: 'Use Broadcast when you need paced notifications across agents.' },
    { scene: 'cta', nav: 'Kanban', heading: 'Ops loop', bullets: ['Chat → Kanban → standup', 'Repeat daily'], pointer: null, caption: 'That is the daily ops loop: chat, board, standup.' },
  ],
  '05-workflows-builder': [
    { scene: 'workflows', nav: 'Workflows', heading: 'Open Workflows', bullets: ['Agentic Workflows in the left nav'], pointer: { label: 'Workflows', target: 'nav' }, caption: 'Open Workflows from the left nav.' },
    { scene: 'workflows', nav: 'Workflows', heading: 'Create & edit', bullets: ['Graph of nodes', 'Map inputs and outputs'], pointer: { label: 'Editor canvas', target: 'main' }, caption: 'Create a workflow, wire nodes, and map inputs to outputs.' },
    { scene: 'workflows', nav: 'Workflows', heading: 'Publish & run', bullets: ['Publish when ready', 'Run and audit executions'], pointer: { label: 'Publish / Run', target: 'main' }, caption: 'Publish, then run — check the run audit for each step.' },
    { scene: 'workflows', nav: 'Workflows', heading: 'Certify (optional)', bullets: ['Maker / Checker', 'Autonomous quality gate'], pointer: { label: 'Certify', target: 'main' }, caption: 'Optional certify uses Maker/Checker before you trust a graph in production.' },
    { scene: 'cta', nav: 'Workflows', heading: 'Automation layer', bullets: ['Chat for intent', 'Workflows for durable automation'], pointer: null, caption: 'Workflows turn one-off chat into repeatable automation.' },
  ],
  '06-master-data-rag': [
    { scene: 'masterData', nav: 'Master Data', heading: 'Master Data', bullets: ['Tables · documents · CSV'], pointer: { label: 'Master Data', target: 'nav' }, caption: 'Master Data holds tables and documents for your org.' },
    { scene: 'masterData', nav: 'Master Data', heading: 'Documents & RAG', bullets: ['Upload guides', 'Agents search with master_data_rag'], pointer: { label: 'Documents', target: 'main' }, caption: 'Upload documents so agents can answer with master_data_rag.' },
    { scene: 'masterData', nav: 'Master Data', heading: 'Platform Help corpus', bullets: ['Protected help docs', 'Always available to Platform Help'], pointer: { label: 'Help docs', target: 'main' }, caption: 'Platform Help corpus is protected — it will not be purged with your uploads.' },
    { scene: 'masterData', nav: 'Master Data', heading: 'Departments table', bullets: ['Name · purpose · budgets'], pointer: { label: 'Departments', target: 'main' }, caption: 'Use the departments table when onboarding agents.' },
    { scene: 'cta', nav: 'Master Data', heading: 'Knowledge layer', bullets: ['Chat cites docs', 'Keep sources current'], pointer: null, caption: 'Keep Master Data current so answers stay grounded.' },
  ],
  '07-tools-api-keys': [
    { scene: 'apiKeys', nav: 'API Keys', heading: 'API Keys vault', bullets: ['BYOK slots for providers', 'Never paste keys in chat'], pointer: { label: 'API Keys', target: 'nav' }, caption: 'Open API Keys to store provider secrets in the vault.' },
    { scene: 'apiKeys', nav: 'API Keys', heading: 'Content tools', bullets: ['Image · video · summarize', 'Logged under Tools'], pointer: { label: 'Tools usage', target: 'main' }, caption: 'Content tools use those keys — check Tools logs when debugging.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'MEDIA: habit', bullets: ['Agents return MEDIA: links', 'Auth media players in chat'], pointer: { label: 'Chat media', target: 'chat' }, caption: 'Prefer MEDIA: links so chat can play authenticated media safely.' },
    { scene: 'apiKeys', nav: 'API Keys', heading: 'Least privilege', bullets: ['Grant tools per agent', 'Review Tool access'], pointer: { label: 'Tool grants', target: 'main' }, caption: 'Grant tools per agent — least privilege keeps the org safe.' },
    { scene: 'cta', nav: 'API Keys', heading: 'Keys + tools', bullets: ['Vault first', 'Then grant access'], pointer: null, caption: 'Vault first, then grant tools deliberately.' },
  ],
  '08-channels-whatsapp': [
    { scene: 'channels', nav: 'Dashboard', heading: 'Agent Channels', bullets: ['Slack / WhatsApp wizard', 'Per-agent bindings'], pointer: { label: 'Channels', target: 'main' }, caption: 'Connect WhatsApp or Slack from an agent Channels wizard.' },
    { scene: 'channels', nav: 'Dashboard', heading: 'Inbound attachments', bullets: ['Media lands in inbound/', 'Visible in Content Explorer'], pointer: { label: 'Inbound media', target: 'main' }, caption: 'Inbound WhatsApp media is saved under inbound attachments.' },
    { scene: 'channels', nav: 'Content Explorer', heading: 'Find uploads', bullets: ['Content Explorer browse', 'Download or delete'], pointer: { label: 'Content Explorer', target: 'nav' }, caption: 'Browse those files in Content Explorer.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Outbound MEDIA:', bullets: ['Agents can attach media', 'Use MEDIA: in replies'], pointer: { label: 'Outbound', target: 'chat' }, caption: 'Outbound replies can attach MEDIA: so WhatsApp gets the file.' },
    { scene: 'cta', nav: 'Dashboard', heading: 'Reach beyond the app', bullets: ['Channels extend the org', 'Keep vault tokens fresh'], pointer: null, caption: 'Channels extend your org beyond the browser.' },
  ],
  '09-browser-content-explorer': [
    { scene: 'browser', nav: 'Browser Session', heading: 'Browser Session', bullets: ['Client Chrome relay', 'Recipes for repeatable tasks'], pointer: { label: 'Browser Session', target: 'nav' }, caption: 'Open Browser Session to connect your client Chrome relay.' },
    { scene: 'browser', nav: 'Browser Session', heading: 'Recipes', bullets: ['Record steps', 'Replay with browse_* tools'], pointer: { label: 'Recipes', target: 'main' }, caption: 'Capture recipes, then let agents replay them with browse tools.' },
    { scene: 'contentExplorer', nav: 'Content Explorer', heading: 'Content Explorer', bullets: ['Uploaded + generated files', 'Preview · download · delete'], pointer: { label: 'Content Explorer', target: 'nav' }, caption: 'Generated and uploaded files land in Content Explorer.' },
    { scene: 'contentExplorer', nav: 'Content Explorer', heading: 'Storage hygiene', bullets: ['Purge when needed', 'Watch Org Storage'], pointer: { label: 'Files list', target: 'main' }, caption: 'Delete what you do not need — storage counts toward your org.' },
    { scene: 'cta', nav: 'Browser Session', heading: 'Browser + files', bullets: ['Automate the web', 'Keep outputs findable'], pointer: null, caption: 'Browser automation plus Content Explorer keeps outputs findable.' },
  ],
  '10-efficiency-budgets': [
    { scene: 'efficiency', nav: 'Efficiency View', heading: 'Efficiency View', bullets: ['Org · Department · Agent tabs'], pointer: { label: 'Efficiency', target: 'nav' }, caption: 'Open Efficiency View to see token and error budgets.' },
    { scene: 'efficiency', nav: 'Efficiency View', heading: 'Budgets', bullets: ['Monthly token budgets', 'Warn then block'], pointer: { label: 'Agent budgets', target: 'main' }, caption: 'Set monthly token and error budgets so agents cannot runaway spend.' },
    { scene: 'efficiency', nav: 'Efficiency View', heading: 'Storage', bullets: ['Org Storage (MB)', 'Includes generated media'], pointer: { label: 'Storage', target: 'main' }, caption: 'Watch Org Storage — media and generated files add up.' },
    { scene: 'profile', nav: null, heading: 'Retention', bullets: ['Profile retention days', 'Daily purge cron'], pointer: { label: 'Profile retention', target: 'avatar' }, caption: 'Pick retention days on Profile so old chats and runs purge automatically.' },
    { scene: 'cta', nav: 'Efficiency View', heading: 'Stay efficient', bullets: ['Budgets + retention', 'Reset usage when needed'], pointer: null, caption: 'Budgets and retention keep the platform healthy.' },
  ],
  '11-avatars-scenes-speech': [
    { scene: 'avatars', nav: '3D Avatars', heading: '3D Avatars', bullets: ['Virtual rooms', '@mention routing'], pointer: { label: '3D Avatars', target: 'nav' }, caption: 'Create 3D Avatars and open a Virtual Room.' },
    { scene: 'avatars', nav: 'Published Scenes', heading: 'Published Scenes', bullets: ['Public /p/vr/:slug', 'Share with guests'], pointer: { label: 'Published Scenes', target: 'nav' }, caption: 'Publish a scene for a public slug guests can open.' },
    { scene: 'orgChat', nav: 'Dashboard', heading: 'Speech in chat', bullets: ['Mic for STT', 'Speak replies with TTS'], pointer: { label: 'Mic / Speak', target: 'chat' }, caption: 'Use free Whisper STT and Piper TTS in chat when voice is enabled.' },
    { scene: 'avatars', nav: '3D Avatars', heading: 'MEDIA in rooms', bullets: ['Prefer MEDIA: overlays', 'Not bare HTTPS dumps'], pointer: { label: 'Media overlay', target: 'main' }, caption: 'In rooms, prefer MEDIA: overlays instead of bare links.' },
    { scene: 'cta', nav: 'Published Scenes', heading: 'Presence layer', bullets: ['Avatars + scenes + speech', 'Share carefully'], pointer: null, caption: 'Avatars, scenes, and speech add presence on top of chat.' },
  ],
  '12-efficient-org-content-studio': [
    { scene: 'hero', heading: 'Efficient content org', bullets: ['Creative → Production → Assembly → Growth'], caption: 'An efficient content studio maps cleanly onto FloLah agents and workflows.', pointer: null, nav: null },
    { scene: 'dashboard', nav: 'Dashboard', heading: 'Departments', bullets: ['Creative · Production', 'Assembly · Growth'], pointer: { label: 'Studio org chart', target: 'main' }, caption: 'Create departments for Creative, Production, Assembly, and Growth.' },
    { scene: 'workflows', nav: 'Workflows', heading: 'Pipeline workflows', bullets: ['W-Reasoning · W-Media', 'W-Assembly publish'], pointer: { label: 'Pipeline graphs', target: 'main' }, caption: 'Wire workflows for brief → plan → media → QC → publish.' },
    { scene: 'browser', nav: 'Browser Session', heading: 'Publish with browser', bullets: ['Recipes for upload sites', 'Growth agent owns distribution'], pointer: { label: 'Publish recipe', target: 'main' }, caption: 'Use Browser recipes when publishing needs a real site login.' },
    { scene: 'cta', nav: 'Dashboard', heading: 'Blueprint ready', bullets: ['Onboarding Helper can propose this', 'See content-creation blueprint'], pointer: { label: 'Start Onboarding', target: 'avatar' }, caption: 'Use Onboarding Helper to propose this org, then refine with Platform Help.' },
  ],
};

export function slidesForStem(stem) {
  return STORYBOARDS[stem] || [
    { scene: 'hero', heading: stem, bullets: ['FloLah Video Tour'], caption: 'FloLah Video Tour', pointer: null, nav: null },
  ];
}