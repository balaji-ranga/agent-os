/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  guideSidebar: [
    'index',
    {
      type: 'category',
      label: '1. Start here',
      collapsed: false,
      items: [
        'start/welcome',
        'start/how-the-company-runs',
        'start/access',
        'start/register',
        'start/sign-in-and-mfa',
        'start/first-15-minutes',
      ],
    },
    {
      type: 'category',
      label: '2. Set up your company',
      collapsed: false,
      items: [
        'setup/company-setup',
        'setup/org-and-departments',
        'setup/people',
        'setup/profile-and-model',
        'setup/api-keys',
        'setup/hire-ai-employees',
        'setup/company-knowledge',
        'setup/update-company-details',
        'setup/onboarding-helper',
      ],
    },
    {
      type: 'category',
      label: '3. Run day to day',
      items: [
        'run/navigation',
        'run/chat-and-coo',
        'run/kanban-standups',
        'run/notifications-digest',
        'run/scheduled-goals',
        'run/operating-effectiveness',
        'run/broadcast',
      ],
    },
    {
      type: 'category',
      label: '4. Tools and systems',
      items: [
        'systems/workflows',
        'systems/connectors-and-mcp',
        'systems/agent-exchange',
        'systems/crm-and-erp',
        'systems/channels',
        'systems/browser-session',
        'systems/content-and-media',
        'systems/policies',
      ],
    },
    {
      type: 'category',
      label: '5. Operate and grow',
      items: [
        'operate/maker-checker',
        'operate/example-stress-test-run',
        'operate/budgets',
        'operate/monitoring-and-llmops',
        'operate/security-tokens',
        'operate/desktop-windows',
        'operate/optional-packs',
        'operate/troubleshooting',
      ],
    },
  ],
};

module.exports = sidebars;
