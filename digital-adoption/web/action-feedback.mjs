// One feedback path for static and dynamically created visitor/owner controls.
export function createActionFeedback(document, { expired = () => false } = {}) {
  const notice = document.createElement("div");
  notice.id = "action-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  notice.style.cssText =
    "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;pointer-events:none;padding:10px;border:1px solid currentColor;border-radius:8px;background:var(--adoption-background,#fff);color:var(--adoption-text,#172440);font:14px system-ui";
  document.body.append(notice);
  let active, timer;
  const report = (message, error = false) => {
    clearTimeout(timer);
    notice.textContent = message;
    notice.dataset.error = String(error);
    notice.hidden = false;
    timer = setTimeout(() => {
      notice.hidden = true;
    }, 3000);
  };
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      if (button.getAttribute("aria-busy") === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      active = {
        button,
        label: button.textContent,
        disabled: button.disabled,
        pending: 0,
      };
      const current = active;
      setTimeout(() => {
        if (active === current && !current.pending) active = null;
      }, 0);
    },
    true,
  );
  const track = (promise) => {
    const action = active;
    if (!action || !action.button.isConnected) { if (active === action) active = null; return promise; }
    action.pending++;
    if (!action.observer) {
      action.button.disabled = true;
      action.observer = new MutationObserver((records) => {
        if (records.length) action.applicationDisabled = action.button.disabled;
      });
      action.observer.observe(action.button, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }
    action.button.setAttribute("aria-busy", "true");
    action.button.dataset.actionPending = "true";
    action.button.textContent = `${action.label} · Working…`;
    report(`${action.label} is working…`);
    return Promise.resolve(promise)
      .then(
        (value) => {
          const banner = document.querySelector("#error-banner");
          if (banner) banner.hidden = true;
          report(`${action.label}: completed.`);
          return value;
        },
        (error) => {
          report(`${action.label}: ${error.message}`, true);
          throw error;
        },
      )
      .finally(() => {
        action.pending--;
        setTimeout(() => {
          if (action.pending) return;
          const changes = action.observer.takeRecords();
          if (changes.length)
            action.applicationDisabled = action.button.disabled;
          action.observer.disconnect();
          if (active === action) active = null;
          if (!action.button.isConnected) return;
          action.button.removeAttribute("aria-busy");
          delete action.button.dataset.actionPending;
          if (action.button.textContent === `${action.label} · Working…`)
            action.button.textContent = action.label;
          action.button.disabled =
            expired() || action.applicationDisabled === true || action.disabled;
        }, 0);
      });
  };
  return { track, report };
}
