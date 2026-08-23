// @ts-check
/** Public Flolah blog + forum hub — served at https://flolah.cloud/blog/ (open access). */

const config = {
  title: 'Flolah Blog',
  tagline: 'Product notes, stories, and community discussion',
  favicon: 'img/flolah-mark.png',

  url: 'https://flolah.cloud',
  baseUrl: '/blog/',
  trailingSlash: true,

  organizationName: 'flolah',
  projectName: 'flolah-blog',

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
        docs: false,
        blog: {
          path: 'blog',
          routeBasePath: '/',
          showReadingTime: true,
          blogTitle: 'Flolah Blog',
          blogDescription: 'Product notes from Flolah and a public forum for builders.',
          postsPerPage: 10,
          exclude: ['README.md', 'README.mdx'],
          blogSidebarTitle: 'Recent posts',
          blogSidebarCount: 12,
          feedOptions: {
            type: 'all',
            title: 'Flolah Blog',
            description: 'Flolah product notes and community posts',
            copyright: `© ${new Date().getFullYear()} Flolah`,
          },
        },
        pages: {
          path: 'blog-pages',
        },
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
      title: 'Flolah Blog',
      logo: {
        alt: 'Flolah',
        src: 'img/flolah-mark.png',
        href: 'https://flolah.cloud',
        target: '_self',
      },
      items: [
        { to: '/', label: 'Posts', position: 'left' },
        { to: '/forum', label: 'Forum', position: 'left' },
        {
          href: 'https://flolah.cloud/docs/',
          label: 'User guide',
          position: 'left',
        },
        {
          href: 'https://flolah.cloud',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://github.com/balaji-ranga/agent-os/discussions',
          label: 'GitHub Discussions',
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
          title: 'Community',
          items: [
            { label: 'Blog', to: '/' },
            { label: 'Forum', to: '/forum' },
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/balaji-ranga/agent-os/discussions',
            },
          ],
        },
        {
          title: 'Product',
          items: [
            { label: 'Home', href: 'https://flolah.cloud' },
            { label: 'User guide', href: 'https://flolah.cloud/docs/' },
            { label: 'Sign in', href: 'https://login.flolah.cloud' },
          ],
        },
        {
          title: 'Legal',
          items: [
            { label: 'Terms', href: 'https://flolah.cloud/legal/terms.html' },
            { label: 'Privacy', href: 'https://flolah.cloud/legal/privacy.html' },
            { label: 'Cookies', href: 'https://flolah.cloud/legal/cookies.html' },
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
