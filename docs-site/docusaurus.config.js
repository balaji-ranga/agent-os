// @ts-check
/** Public Flolah user guide — served at https://flolah.cloud/docs/ (open access). */

const config = {
  title: 'Flolah Docs',
  tagline: 'Run your AI company — from first sign-in to day-to-day operations',
  favicon: 'img/flolah-mark.png',

  url: 'https://flolah.cloud',
  baseUrl: '/docs/',
  trailingSlash: true,

  organizationName: 'flolah',
  projectName: 'flolah-docs',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],

  themeConfig: {
    image: 'img/flolah-mark.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Flolah Docs',
      logo: {
        alt: 'Flolah',
        src: 'img/flolah-mark.png',
        href: 'https://flolah.cloud',
        target: '_self',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guideSidebar',
          position: 'left',
          label: 'User guide',
        },
        {
          href: 'https://flolah.cloud',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://github.com/balaji-ranga/agent-os',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://login.flolah.cloud',
          label: 'Sign in',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Guide',
          items: [
            { label: 'Access Flolah', to: '/start/access' },
            { label: 'Register', to: '/start/register' },
            { label: 'Company setup', to: '/setup/company-setup' },
            { label: 'Org and departments', to: '/setup/org-and-departments' },
            { label: 'Run day to day', to: '/run/chat-and-coo' },
          ],
        },
        {
          title: 'Product',
          items: [
            { label: 'Home', href: 'https://flolah.cloud' },
            { label: 'Vision', href: 'https://flolah.cloud/vision' },
            { label: 'GitHub', href: 'https://github.com/balaji-ranga/agent-os' },
            { label: 'Sign in', href: 'https://login.flolah.cloud' },
          ],
        },
        {
          title: 'Legal',
          items: [
            { label: 'Terms', href: 'https://flolah.cloud/legal/terms.html' },
            { label: 'Privacy', href: 'https://flolah.cloud/legal/privacy.html' },
            { label: 'Cookies', href: 'https://flolah.cloud/legal/cookies.html' },
            { label: 'Open source', href: 'https://flolah.cloud/legal/open-source.html' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Flolah — Automate, Innovate, Elevate.`,
    },
    prism: {
      theme: require('prism-react-renderer').themes.github,
      darkTheme: require('prism-react-renderer').themes.dracula,
    },
  },
};

module.exports = config;
