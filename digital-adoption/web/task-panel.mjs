import { encodeFile } from './files.mjs';
export function mountTaskPanel({
  call,
  showError,
  show,
  clearPrivate,
  isExpired=()=>false
}) {
  const panel = document.createElement('details');
  panel.id = 'private-task';
  panel.hidden = true;
  panel.innerHTML = '<summary>Task files & paired copilots</summary><p>Private to this task. End task deletes files and extracted context. Applied website values remain.</p><label>Transaction file <input id="transaction-file" type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"></label><div class="row"><button type="button" id="task-summary">Summarize files</button><button type="button" id="task-end">End task</button></div><p id="task-identity"></p><ul id="task-files"></ul><details><summary>Pair another copilot</summary><button type="button" id="pair-invite">Create pairing code</button><p id="pair-code"></p><form id="pair-join"><label>Code from the other panel<input name="code" autocomplete="off" required maxlength="64"></label><button>Connect</button></form><button type="button" id="pair-refresh">Refresh paired sessions</button><div id="pair-members"></div><button type="button" id="pair-link">Link group to my Flolah workflows</button><p id="pair-link-code"></p><label>Handoff instruction <input id="relay-instruction" maxlength="8000" placeholder="Use relevant values to prepare the next form"></label><label><input id="relay-consent" type="checkbox"> Share relevant private task context with the selected paired panel</label></details><p id="task-state" role="status" aria-live="polite"></p>';
  document.querySelector('#guide-chat').before(panel);
  const state = panel.querySelector('#task-state'),
    files = panel.querySelector('#task-files');
  let active = false,
    timer;
  const run = async fn => {
    try {
      await fn();
    } catch (error) {
      showError(error);
    }
  };
  const renderTask = t => {
    active = true;
    panel.querySelector('#task-identity').textContent=`Task ID: ${t.taskId}`;
    files.replaceChildren();
    for (const f of t.files) {
      const li = document.createElement('li');
      li.textContent = `${f.filename} · ${f.status}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.onclick = () => run(async () => {
        await call('task-remove', {
          attachmentId: f.id
        });
        await refreshTask();
      });
      li.append(remove);
      files.append(li);
    }
    state.textContent = `Private task · expires ${new Date(t.expiresAt).toLocaleTimeString()}`;
  };
  const refreshTask = async () => {
    if (active) renderTask(await call('task-status'));
  };
  panel.querySelector('#transaction-file').onchange = () => run(async () => {
    const input = panel.querySelector('#transaction-file'),
      file = input.files[0];
    if (!file) return;
    state.textContent = 'Uploading private transaction file…';
    const data = await encodeFile(file);
    renderTask(await call('task-start'));
    await call('task-upload', {
      ...data,
      operationId: crypto.randomUUID()
    });
    input.value = '';
    await refreshTask();
    clearInterval(timer);
    timer = setInterval(() => {
      refreshTask().catch(() => {});
    }, 3000);
  });
  panel.querySelector('#task-summary').onclick = () => run(async () => {
    const out = await call('task-summary');
    show(out.message);
    for (const e of out.evidence) show(`${e.filename} · ${e.locator}\n${e.text}`);
  });
  const reset = () => {
    active = false;
    clearInterval(timer);
    files.replaceChildren();
    state.textContent = 'Task ended. Private files and context cleared.';
    panel.querySelector('#transaction-file').value = '';
    panel.querySelector('#relay-instruction').value = '';
    panel.querySelector('#relay-consent').checked = false;
    clearPrivate();
    panel.querySelector('#task-identity').textContent='';
    document.querySelector('#plan').disabled=isExpired();
    document.querySelector('#stop').hidden=true;
  };
  panel.querySelector('#task-end').onclick = () => run(async () => {
    await call('task-end');
    reset();
  });
  async function pairs() {
    const out = await call('pair-status'),
      list = panel.querySelector('#pair-members');
    list.replaceChildren();
    for (const pending of out.pending) {
      const row = document.createElement('p');
      row.textContent = `Confirm ${pending.origin} · ${pending.environment} · ${pending.instanceId.slice(0, 8)}`;
      if (!pending.confirmed) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Confirm this panel';
        b.onclick = () => run(async () => {
          await call('pair-confirm', {
            invitationId: pending.invitationId
          });
          await pairs();
        });
        row.append(b);
      } else row.append(' · waiting for counterpart confirmation');
      list.append(row);
    }
    for (const m of out.members) {
      const row = document.createElement('p');
      row.textContent = `${m.origin} · ${m.environment} · panel ${m.instanceId.slice(0, 8)}${m.instanceId === out.instanceId ? ' (this panel)' : ''} · ${m.active ? 'online' : 'offline'}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Disconnect';
      remove.onclick = () => run(async () => {
        await call('pair-revoke', {
          targetId: m.instanceId
        });
        await pairs();
      });
      const relay = document.createElement('button');
      relay.type = 'button';
      relay.textContent = 'Send task here';
      relay.disabled = !m.active || m.instanceId === out.instanceId;
      relay.onclick = () => run(async () => {
        await call('task-relay', {
          targetId: m.instanceId,
          shareConsent: panel.querySelector('#relay-consent').checked,
          instruction: panel.querySelector('#relay-instruction').value
        });
        state.textContent = 'Task context shared. Review and continue in the selected panel.';
      });
      row.append(remove, relay);
      list.append(row);
    }
    state.textContent = out.groupId ? `Paired group ${out.groupId} · ${out.workflowLinked ? 'linked to Flolah user' : 'anonymous'}` : 'No paired group yet.';
  }
  panel.querySelector('#pair-invite').onclick = () => run(async () => {
    const out = await call('pair-invite');
    panel.querySelector('#pair-code').textContent = `${out.code} · expires ${new Date(out.expiresAt).toLocaleTimeString()}. Enter in the other panel, then confirm in both panels.`;
  });
  panel.querySelector('#pair-join').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const input = event.target.elements.code;
      await call('pair-join', {
        code: input.value.trim()
      });
      input.value = '';
      await pairs();
    });
  };
  panel.querySelector('#pair-refresh').onclick = () => run(pairs);
  panel.querySelector('#pair-link').onclick = () => run(async () => {
    const out = await call('pair-link');
    panel.querySelector('#pair-link-code').textContent = `${out.code} · expires ${new Date(out.expiresAt).toLocaleTimeString()}. In Flolah Workflow Editor, select the Copilot connector and link this code.`;
  });
  return {
    configure(config) {
      panel.hidden = !Object.values(config.taskPolicy || {}).some(v => v === true);
      panel.querySelector('#transaction-file').disabled = !config.taskPolicy?.attachments;
      panel.querySelector('#pair-invite').disabled = !config.taskPolicy?.pairing;
      panel.querySelector('#pair-link').disabled = !config.taskPolicy?.workflow;
    },
    event(event) {
      if(event.type==='workflow-started'){active=true;panel.open=true;document.querySelector('#review').replaceChildren();document.querySelector('#plan').disabled=true;state.textContent=`Workflow ${event.action} is running. End task cancels remaining work.`;show(`Your linked workflow requested ${event.action}.`);refreshTask().catch(showError);return;}
      if(event.type==='workflow-result'){document.querySelector('#plan').disabled=isExpired();state.textContent=event.ok?'Workflow step completed. Business-save verification remains separate.':'Workflow step failed or its outcome is unknown. Inspect the host before trying again.';if(!event.ok)showError(new Error(state.textContent));return;}
      if (event.type === 'task-ended') reset();else if (event.type === 'task-shared') {
        active = true;
        panel.open = true;
        show(`Task shared from ${event.from}. ${event.instruction}`);
        refreshTask().catch(showError);
      } else if (event.type === 'workflow-proposal') {
        panel.open = true;
        const review = document.querySelector('#review');
        review.replaceChildren();
        for (const action of event.proposal.actions) {
          const line = document.createElement('p');
          line.textContent = action.type === 'navigate' ? `Open ${action.label}` : `${action.label}: ${action.value}`;
          review.append(line);
        }
        if (event.proposal.actions.length) {
          const approve = document.createElement('button');
          approve.type = 'button';
          approve.textContent = 'Approve prepared changes';
          approve.onclick = () => run(async () => {
            approve.disabled = true;
            const out = await call('approve', {
              proposalId: event.proposal.id
            });
            review.replaceChildren();
            show(out.results.every(r => r.valueObserved) ? 'Approved field values were observed. Save was not clicked.' : 'Prepared action completed; inspect the host outcome.');
          });
          review.append(approve);
        }
        show(event.proposal.message);
      }
    },
    reset
  };
}
