{
  document.documentElement.dataset.prototypeReady = 'true';
  const modal = document.getElementById('launcher');
  const open = document.getElementById('openLauncher');
  const close = document.getElementById('closeLauncher');
  const search = document.getElementById('capSearch');
  const toast = document.getElementById('destinationToast');
  const app = document.getElementById('app');
  const openCoo = document.getElementById('openCoo');
  const titles = {
    company: ['Company space', 'A living map of work, ownership and momentum—not another dashboard.'],
    execution: ['Execution flow', 'See information and evidence move between AI employees, humans and tools.'],
    people: ['People & AI', 'Capacity, reporting lines and handoffs in one company constellation.'],
  };
  const primaryPages = {
    home: ['Friday · Company pulse', 'Good morning, Balaji.', 'Focused on: Dental lead generation · Goal #4821'],
    digest: ['Daily Digest', 'Your company, distilled.', 'Focused on: today’s outcomes, decisions and risks'],
    workspace: ['Workspace', 'Move work from intent to outcome.', 'Focused on: your goals, tasks and team handoffs'],
    objectives: ['Objectives & Key Results', 'Connect strategy to execution evidence.', 'Focused on: objectives, key results, initiatives and evidence'],
    live: ['Live Operations', 'See the company working in real time.', 'Focused on: active agents, workflows and system health'],
    reviews: ['Reviews', 'Decide with context and evidence.', 'Focused on: approvals, policy gates and exceptions'],
  };

  const show = () => {
    modal.hidden = false;
    window.setTimeout(() => search.focus(), 0);
  };
  const hide = () => { modal.hidden = true; };

  open.addEventListener('click', show);
  close.addEventListener('click', hide);
  openCoo.addEventListener('click', () => app.classList.toggle('chat-open'));
  modal.addEventListener('click', (event) => { if (event.target === modal) hide(); });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      show();
    }
    if (event.key === 'Escape') hide();
  });

  document.querySelectorAll('[data-scene]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.scene;
      document.querySelectorAll('[data-scene]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-view]').forEach((scene) => { scene.hidden = scene.dataset.view !== view; });
      document.getElementById('sceneTitle').textContent = titles[view][0];
      document.getElementById('sceneSub').textContent = titles[view][1];
    });
  });

  document.querySelectorAll('[data-primary]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.primary;
      document.querySelectorAll('[data-primary]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-primary-view]').forEach((view) => { view.hidden = view.dataset.primaryView !== page; });
      document.getElementById('pageEyebrow').textContent = primaryPages[page][0];
      document.getElementById('pageTitle').textContent = primaryPages[page][1];
      document.querySelector('.coo .context').textContent = primaryPages[page][2];
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  search.addEventListener('input', () => {
    const query = search.value.toLowerCase();
    document.querySelectorAll('.cap').forEach((item) => { item.hidden = !item.textContent.toLowerCase().includes(query); });
    document.querySelectorAll('.cap-group').forEach((group) => {
      group.hidden = !Array.from(group.querySelectorAll('.cap')).some((item) => !item.hidden);
    });
  });

  document.querySelectorAll('.cap').forEach((item) => {
    item.addEventListener('click', () => {
      hide();
      toast.textContent = `${item.childNodes[0].textContent.trim()} opens in the same spatial shell with contextual actions and COO assistance.`;
      toast.classList.add('show');
      window.setTimeout(() => toast.classList.remove('show'), 2600);
    });
  });
}
