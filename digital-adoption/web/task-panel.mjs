import {appendProposedAction} from './review-card.mjs';
import { encodeFile } from "./files.mjs";
export function mountTaskPanel({
  call,
  showError,
  show,
  clearPrivate,
  isExpired = () => false,
}) {
  const panel = document.createElement("details");
  panel.id = "private-task";
  panel.hidden = true;
  panel.innerHTML = `<summary>Task files & paired copilots</summary><p id="private-retention-notice">Files and extracted values are private to this task. End task clears task history and access immediately. Original uploads are deleted; extracted passages remain in private temporary search storage until its 24-hour retention cleanup. Pairing groups have their own lifetime.</p><label>Transaction file <input id="transaction-file" type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"></label><div class="row"><button type="button" id="task-summary">Summarize files</button><button type="button" id="task-end">End task</button></div><p id="task-identity"></p><ul id="task-files"></ul><details><summary>Pairing & workflow access</summary><label>Connection group name <input id="pair-name" maxlength="80" value="My paired copilots"></label><label>Pairing lifetime <select id="pair-lifetime"><option value="1">1 hour</option><option value="4" selected>4 hours</option><option value="8">8 hours</option><option value="24">24 hours</option><option value="0">Until revoked on this browser</option></select></label><label>Pairing inactivity <select id="pair-inactivity"><option value="0">No separate inactivity expiry</option><option value="15">15 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option></select></label><p>For pairing, both panels confirm the initial settings. The website owner can later revoke, shorten or extend expiry; you can disconnect at any time. Workflow linking also works with this copilot alone. Saved browser access can reconnect; offline tabs receive nothing and failed actions never replay.</p><button type="button" id="pair-invite">Create pairing code</button><p id="pair-code"></p><form id="pair-join"><label>Code from the other panel<input name="code" autocomplete="off" required maxlength="64"></label><button>Connect</button></form><button type="button" id="pair-refresh">Refresh paired sessions</button><div id="pair-members"></div><button type="button" id="pair-link">Link this copilot to my Flolah workflows</button><p id="pair-link-code"></p><label><input id="relay-consent" type="checkbox"> Share relevant private task context with the recipient selected in chat</label></details><p id="task-state" role="status" aria-live="polite"></p>`;
  document.querySelector("#task-content").append(panel);panel.open=true;
  const connections=panel.querySelector('details');connections.id='pairing-settings';connections.open=true;document.querySelector('#connections-content').append(connections);
  const pairState=document.createElement('p');pairState.id='pair-state';pairState.setAttribute('role','status');pairState.textContent='No connection status loaded. Peer pairing and Flolah workflow linking are separate.';connections.append(pairState);
  const query=selector=>document.querySelector(selector);
  const state = query("#task-state"),
    files = query("#task-files"),
    composer = document.querySelector("#message"),
    log = document.querySelector("#log");
  const uploadNotice=document.createElement('p');uploadNotice.id='task-upload-limits';query('#transaction-file').closest('label').after(uploadNotice);
  let uploadLimits={},uploadEnabled=false,uploadTimer,uploadBusy=false,uploadUntil=0;
  const coolUpload=seconds=>{const input=query('#transaction-file');input.disabled=true;uploadUntil=Date.now()+seconds*1000;clearTimeout(uploadTimer);uploadTimer=setTimeout(()=>{input.disabled=!uploadEnabled||uploadBusy;},Math.min(seconds*1000,2147483647));};
  const mentions = document.createElement("div");
  mentions.id = "paired-mentions";
  mentions.hidden = true;
  document.querySelector("#guide-chat").append(mentions);
  let active = false,
    pairing = false,
    members = [],
    timer,
    presenceTimer,
    checkingPresence = false;
  const workflows = new Map(),
    safeTraces = [];
  const run = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      showError(error);
    }
  };
  const button = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = () => run(fn);
    return b;
  };
  const renderTask = (t) => {
    active = true;
    query("#task-identity").textContent = `Task ID: ${t.taskId}`;
    files.replaceChildren();
    for (const f of t.files) {
      const li = document.createElement("li");
      li.textContent = `${f.filename} · ${f.status}`;
      if (f.canRemove === true)
        li.append(
          button("Remove", async () => {
            await call("task-remove", { attachmentId: f.id });
            await refreshTask();
          }),
        );
      else li.append(" · shared for this task");
      files.append(li);
    }
    state.textContent = `Private task · expires ${new Date(t.expiresAt).toLocaleTimeString()}`;
  };
  let refreshingTask=false;
  const refreshTask = async () => {
    if(!active||refreshingTask)return;
    refreshingTask=true;try{const task=await call('task-status');if(active)renderTask(task);}finally{refreshingTask=false;}
  };
  query("#transaction-file").onchange = () =>
    run(async () => {
      const input = query("#transaction-file"),
        file = input.files[0];
      if (!file) return;
      if(file.size>(uploadLimits.fileBytes||16777216))throw new Error('This file exceeds this website’s task file size limit.');
      input.disabled=true;uploadBusy=true;
      try{
      state.textContent = "Uploading private transaction file…";
      const data = await encodeFile(file);
      renderTask(await call("task-start"));
      await call("task-upload", { ...data, operationId: crypto.randomUUID() });
      input.value = "";
      await refreshTask();
      clearInterval(timer);
      timer = setInterval(
        () =>
          refreshTask().catch((error) => {
            if (/ended/i.test(error.message)) reset();
            else showError(error);
          }),
        3000,
      );
      coolUpload(Math.ceil((uploadLimits.cooldownMs||0)/1000));
      }catch(error){if(error.retryAfterSeconds)coolUpload(error.retryAfterSeconds);input.value='';throw error;}finally{uploadBusy=false;input.disabled=!uploadEnabled||Date.now()<uploadUntil;}
    });
  query("#task-summary").onclick = () =>
    run(async () => {
      const out = await call("task-summary");
      show(out.message);
      for (const e of out.evidence || [])
        show(`${e.filename} · ${e.locator}\n${e.text}`);
    });
  const reset = () => {
    active = false;
    clearInterval(timer);
    files.replaceChildren();
    state.textContent =
      "Task ended. Private files, instructions and extracted context cleared. Saved pairing is separate.";
    query("#transaction-file").value = "";
    query("#relay-consent").checked = false;
    query("#task-identity").textContent = "";
    clearPrivate();
    for (const trace of safeTraces.slice(-20)) show(trace);
    workflows.clear();
    document.querySelector("#plan").disabled = isExpired();
    document.querySelector("#stop").hidden = true;
  };
  query("#task-end").onclick = () =>
    run(async () => {
      await call("task-end");
      safeTraces.length = 0;
      reset();
    });
  const alias = (m) => `${new URL(m.origin).host}-${m.instanceId.slice(0, 8)}`;
  function renderPairs(out) {
    pairing = !!out.groupId;
    if (!presenceTimer && (pairing || out.pending?.length)) presenceTimer = setInterval(async () => {
      if (checkingPresence || document.hidden || isExpired()) return;
      checkingPresence = true;
      try { await pairs(); }
      catch { members = members.map(m => ({...m, active:false})); mentions.replaceChildren(); mentions.hidden = true; pairState.textContent = 'Pairing presence unavailable. Refresh or reconnect before sending.'; }
      finally { checkingPresence = false; }
    }, 10000);
    if (!pairing && !out.pending?.length) { clearInterval(presenceTimer); presenceTimer = null; }
    members = out.members || [];
    const list = query("#pair-members");
    list.replaceChildren();
    for (const pending of out.pending || []) {
      const row = document.createElement("p");
      row.textContent = `Confirm ${pending.origin} · ${pending.environment} · ${pending.policy?.name || "Paired copilots"} · ${pending.policy?.expiresAt !== undefined ? (pending.policy.expiresAt ? "expires " + new Date(pending.policy.expiresAt).toLocaleString() : "until revoked") : pending.policy?.lifetimeHours ? pending.policy.lifetimeHours + " hours" : "until revoked"} · inactivity ${pending.policy?.inactivityMinutes || "off"} minutes. `;
      if (!pending.confirmed)
        row.append(
          button("Confirm this panel", async () => {
            renderPairs(
              await call("pair-confirm", {
                invitationId: pending.invitationId,
              }),
            );
          }),
        );
      else row.append("Waiting for counterpart confirmation");
      list.append(row);
    }
    for (const m of members) {
      const row = document.createElement("p");
      row.textContent = `${m.origin} · ${m.environment} · ${m.instanceId === out.instanceId ? "this panel" : `@${alias(m)}`} · ${m.active ? "online" : "offline"} `;
      row.append(
        button("Disconnect", async () =>
          renderPairs(await call("pair-revoke", { targetId: m.instanceId })),
        ),
      );
      list.append(row);
    }
    const others = members.filter((m) => m.instanceId !== out.instanceId);
    pairState.textContent = out.groupId
      ? `${out.name || "Paired group"} · ${out.groupId} · ${others.filter((m) => m.active).length} counterpart(s) online · ${out.workflowLinked ? "linked to Flolah user" : "not linked to workflows"} · ${out.expiresAt ? "expires " + new Date(out.expiresAt).toLocaleString() : "until revoked"}`
      : "No connected group. Pair for peer handoffs, or link this copilot directly to Flolah workflows.";
    mentions.replaceChildren();
    for (const m of others.filter((m) => m.active && m.canHandoff)) {
      mentions.append(
        button(`@${alias(m)}`, async () => {
          composer.value = `@${alias(m)} ${composer.value.replace(/^@\S*\s*/, "")}`;
          mentions.hidden = true;
          composer.focus();
        }),
      );
    }
  }
  composer.addEventListener("input", () => {
    mentions.hidden = !composer.value.startsWith("@");
  });
  const pairs = async () => {
    const out = await call("pair-status");
    renderPairs(out);
    return out;
  };
  window.addEventListener('pagehide', () => { clearInterval(presenceTimer); clearInterval(timer); });
  query("#pair-invite").onclick = () =>
    run(async () => {
      const out = await call("pair-invite", {
        name: query("#pair-name").value,
        lifetimeHours: Number(query("#pair-lifetime").value),
        inactivityMinutes: Number(
          query("#pair-inactivity").value,
        ),
      });
      query("#pair-code").textContent =
        `${out.code} · expires ${new Date(out.expiresAt).toLocaleTimeString()}. Enter in the other panel and confirm the displayed lifetime in both.`;
    });
  query("#pair-join").onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const input = event.target.elements.code;
      await call("pair-join", { code: input.value.trim() });
      input.value = "";
      await pairs();
    });
  };
  query("#pair-refresh").onclick = () => run(pairs);
  query("#pair-link").onclick = () =>
    run(async () => {
      const out = await call("pair-link",{name:query("#pair-name").value,lifetimeHours:Number(query("#pair-lifetime").value),inactivityMinutes:Number(query("#pair-inactivity").value)});
      query("#pair-link-code").textContent =
        `${out.code} · expires ${new Date(out.expiresAt).toLocaleTimeString()}. In Flolah, link this code to a new or selected existing workflow target group. Pairing is optional; peer handoffs need separate bilateral confirmation.`;
    });
  function structuralSummary(observed) {
    if (!observed) return "";
    return [
      `Page ${observed.path || ""}: ${observed.forms?.length || 0} forms, ${observed.fields?.length || 0} supported fields, ${observed.links?.length || 0} approved navigation links.`,
      ...(observed.fields || []).map(
        (f) => `${f.label} (${f.type}${f.required ? ", required" : ""})`,
      ),
      ...(observed.links || []).map((l) => `${l.label}: ${l.path}`),
    ].join("\n");
  }
  return {
    async sendIfMention(text) {
      const match = /^@(\S+)\s+([\s\S]+)/.exec(text);
      if (!match) return false;
      const target = members.filter((m) => alias(m) === match[1] && m.canHandoff);
      if (target.length !== 1 || !target[0].active)
        throw new Error(
          "Select an online paired recipient using @ in chat. Nothing was sent.",
        );
      if (!query("#relay-consent").checked)
        throw new Error(
          "Select private-context sharing consent in Connections before sending.",
        );
      const out = await call("task-relay", {
        targetId: target[0].instanceId,
        shareConsent: true,
        instruction: match[2],
      });
      show(
        `Sent to ${target[0].origin} at ${new Date().toLocaleTimeString()}: ${match[2]}\n${(out.context || []).map((e) => `${e.filename} · ${e.locator}: ${e.text}`).join("\n")}\nDelivered to the paired task.`,
      );
      return true;
    },
    configure(config) {
      query("#private-retention-notice").textContent=`Files and extracted values are private to this task. End task clears task history and access immediately. Original uploads are deleted; extracted passages use ${config.privateRetentionHours||24}-hour temporary retention. Pairing and explicitly archived chats have separate access lifecycles.`;
      uploadLimits={...config.uploadLimits,fileBytes:Math.min(config.uploadLimits?.fileBytes||16777216,config.taskPolicy?.limits?.fileBytes||16777216)};uploadEnabled=config.taskPolicy?.attachments===true;
      uploadNotice.textContent=config.uploadLimits?`Private task files: up to ${Math.ceil(uploadLimits.fileBytes/1048576)} MiB each; ${Math.ceil(uploadLimits.cooldownMs/1000)} seconds between uploads; ${uploadLimits.sessionRequests} requests per ${Math.ceil(uploadLimits.windowMs/60000)} minute. This session allows ${uploadLimits.sessionFiles} files / ${Math.ceil(uploadLimits.sessionBytes/1048576)} MiB per ${Math.ceil(uploadLimits.retentionWindowMs/3600000)} hours. Website and platform limits also apply. Removing files or ending tasks does not reset the allowance.`:'Server-enforced file, upload and processing limits apply.';
      panel.hidden = !Object.values(config.taskPolicy || {}).some(
        (v) => v === true,
      );
      query("#transaction-file").disabled =
        !config.taskPolicy?.attachments||uploadBusy||Date.now()<uploadUntil;
      query("#pair-invite").disabled =
        !config.taskPolicy?.pairing;
      query("#pair-link").disabled = !config.taskPolicy?.workflow;
      const policy=config.taskPolicy||{},hasConnections=policy.pairing===true||policy.workflow===true;
      for(const id of ['pair-invite','pair-join'])query('#'+id).hidden=policy.pairing!==true;
      for(const id of ['pair-link','pair-link-code'])query('#'+id).hidden=policy.workflow!==true;
      query('#relay-consent').closest('label').hidden=policy.pairing!==true;
      query('#transaction-file').closest('label').hidden=!uploadEnabled;uploadNotice.hidden=!uploadEnabled;
      query('#task-summary').hidden=!uploadEnabled;query('#task-summary').disabled=!uploadEnabled;
      connections.hidden=!hasConnections;
      if(!hasConnections){clearInterval(presenceTimer);presenceTimer=null;members=[];mentions.replaceChildren();mentions.hidden=true;}

    },
    event(event) {
      if (event.type === "pairing-restored") {
        panel.open=true;connections.open=true;
        renderPairs(event.status);
        return;
      }
      if (event.type === "pairing-offline") {
        clearInterval(presenceTimer); presenceTimer = null;
        members = [];
        mentions.replaceChildren();
        mentions.hidden = true;
        query("#pair-members").replaceChildren();
        pairState.textContent = event.reason;
        pairing = false;
        return;
      }
      if(event.type==='pairing-policy-updated'){show(`Website owner updated pairing expiry: ${event.expiresAt?new Date(event.expiresAt).toLocaleString():'until revoked'}. You can disconnect at any time.`);pairs().catch(showError);return;}
      if (event.type === "connection-restored") {
        if (event.paired) pairs().catch(showError);
        return;
      }
      if (event.type === "workflow-started") {
        active = true;
        document.querySelector("#review").replaceChildren();
        document.querySelector("#plan").disabled = true;
        const title = `Workflow ${event.workflow?.id || "linked workflow"} · run ${event.workflow?.runId || ""} · step ${event.workflow?.nodeId || event.action}`;
        const article = document.createElement("article");
        article.dataset.workflowCommand = event.commandId;
        const incoming = document.createElement("p"),
          progress = document.createElement("p");
        incoming.textContent = `${title}\nInstruction: ${event.instruction}`;
        progress.textContent = "Working…";
        article.append(incoming, progress);
        log.append(article);
        article.scrollIntoView({ block: "nearest" });
        const activity=document.createElement('article'),activityTitle=document.createElement('p'),activityProgress=document.createElement('p');activityTitle.textContent=title;activityProgress.textContent='Running · '+event.action;activity.append(activityTitle,activityProgress);document.querySelector('#workflow-empty')?.remove();document.querySelector('#workflow-activity').append(activity);while(document.querySelector('#workflow-activity').children.length>20)document.querySelector('#workflow-activity').firstElementChild.remove();
        workflows.set(event.commandId, { article, progress, title,activityProgress });
        state.textContent = `Workflow ${event.action} is running. End task cancels remaining work.`;
        refreshTask().catch(showError);
        return;
      }
      if(event.type==='workflow-observation'){const item=workflows.get(event.commandId);if(item){item.localFailure=event.reason;item.progress.textContent=event.reason?`Local execution stopped: ${event.reason}. Waiting for the workflow service to confirm its outcome.`:'Local observation reported. Waiting for the workflow service to confirm its outcome.';}return;}
      if (event.type === "workflow-result") {
        document.querySelector("#plan").disabled = isExpired();
        const item = workflows.get(event.commandId),
          summary =
            event.action === "inspect"
              ? structuralSummary(event.result?.observed)
              : event.result?.message || "";
        if (item) {
          item.activityProgress.textContent=event.ok?`Completed · ${event.outcome||'effect observed'}`:`Stopped · ${event.code||'outcome unknown'}`;
          item.progress.textContent = event.ok
            ? `Completed (${event.outcome||"effect observed"}).\n${summary || "Requested step completed. Business save verification is separate."}`
            : `Step stopped (${event.code||"execution failed"}). ${item.localFailure||'Inspect the host before retrying; completed changes remain.'}`;
          safeTraces.push(
            `${item.title}: ${event.ok ? "completed" : "failed"}. Private task instruction/data cleared at task end.${event.action === "inspect" ? "\n" + summary : ""}`,
          );
          if (safeTraces.length > 20) safeTraces.splice(0, safeTraces.length - 20);
          item.progress.scrollIntoView({ block: "nearest" });
        }
        state.textContent = event.ok
          ? "Workflow step completed."
          : "Workflow step failed or outcome unknown.";
        if(!event.ok)showError(Object.assign(new Error('Workflow step stopped. Inspect the host before retrying; earlier effects remain.'),{code:event.code}));
        return;
      }
      if (event.type === "task-ended") {
        reset();
        return;
      }
      if (event.type === "task-active") {active=true;refreshTask().catch(showError);return;}
      if (event.type === "task-shared") {
        active = true;
        show(`Task shared from ${event.from}: ${event.instruction}`);
        refreshTask().catch(showError);
        return;
      }
      if (event.type === "workflow-proposal") {
        const review = document.querySelector("#review");
        review.replaceChildren();
        for(const action of event.proposal.actions)appendProposedAction(document,review,event.proposal,action);
        if (event.proposal.actions.length) {
          review.append(
            button("Approve prepared changes", async () => {
              const out = await call("approve", {
                proposalId: event.proposal.id,
              });
              review.replaceChildren();
              show(
                out.results.every((r) => r.valueObserved)
                  ? "Approved values observed. Save was not clicked."
                  : "Inspect the host outcome.",
              );
            }),
            button("Reject changes", async () => {
              await call("reject", { proposalId: event.proposal.id });
              review.replaceChildren();
              show("Changes rejected. Nothing was applied.");
            }),
          );
        }
        const current=workflows.get(event.commandId);if(current?.activityProgress?.isConnected)current.activityProgress.textContent='Waiting for your field review in Chat';
        show(event.proposal.message);
      }
    },
    reset,
  };
}
