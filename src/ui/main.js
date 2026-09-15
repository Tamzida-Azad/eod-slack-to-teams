const app = document.getElementById('app');

function path() {
  return window.location.pathname.replace(/\/$/, '') || '/';
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function navHtml(active) {
  const links = [
    ['/', 'Status'],
    ['/integrations', 'Integrations'],
    ['/integrations/slack', 'Slack OAuth'],
    ['/integrations/teams', 'Teams OAuth'],
  ];
  return `<nav class="nav">${links
    .map(
      ([href, label]) =>
        `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`
    )
    .join('')}</nav>`;
}

function badge(status) {
  const s = status || 'missing';
  return `<span class="badge ${s}">${s}</span>`;
}

function getSecret() {
  return localStorage.getItem('eod_run_secret') || '';
}

function setSecret(v) {
  localStorage.setItem('eod_run_secret', v);
}

function authHeaders() {
  const secret = getSecret();
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers['x-run-secret'] = secret;
  }
  return headers;
}

async function fetchIntegrations() {
  const res = await fetch('/api/integrations/status');
  return res.json();
}

function renderHome() {
  app.innerHTML = `
    <main class="page">
      ${navHtml('/')}
      <header class="hero">
        <p class="brand">EOD Slack → Teams</p>
        <h1>Nightly digest status</h1>
        <p class="sub">
          Runs as your connected Slack + Teams user (OAuth).
          Channel <code>#calysta-eod</code> → <strong>Calystapro EMR Web Dev</strong>
        </p>
      </header>
      <section class="panel" id="integ-summary">
        <h2>Connections</h2>
        <p class="integ-meta">Loading…</p>
      </section>
      <section class="panel">
        <div class="row">
          <label for="secret">Run secret</label>
          <input id="secret" type="password" placeholder="RUN_SECRET / CRON_SECRET" autocomplete="off" />
        </div>
        <div class="actions">
          <button type="button" id="btn-refresh">Refresh status</button>
          <button type="button" id="btn-dry" class="secondary">Dry run</button>
          <button type="button" id="btn-run" class="danger">Run now</button>
        </div>
        <p id="message" class="message" hidden></p>
      </section>
      <section class="panel">
        <h2>Last run</h2>
        <pre id="last-run">Loading…</pre>
      </section>
      <section class="panel">
        <h2>Day state</h2>
        <pre id="day-state">Loading…</pre>
      </section>
    </main>
  `;

  const secretEl = document.getElementById('secret');
  secretEl.value = getSecret();
  secretEl.addEventListener('change', () => setSecret(secretEl.value));

  const messageEl = document.getElementById('message');
  function showMessage(text, isError = false) {
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.toggle('error', isError);
  }

  async function refreshIntegrations() {
    const box = document.getElementById('integ-summary');
    try {
      const data = await fetchIntegrations();
      box.innerHTML = `
        <h2>Connections</h2>
        <p class="integ-meta">
          Slack ${badge(data.slack?.status)}
          ${data.slack?.user ? `· ${data.slack.user}` : ''}
          ${data.slack?.team ? `(${data.slack.team})` : ''}
          <br/>
          Teams ${badge(data.teams?.status)}
          ${data.teams?.user ? `· ${data.teams.user}` : ''}
          <br/><a href="/integrations">Manage integrations</a>
        </p>`;
    } catch (e) {
      box.innerHTML = `<h2>Connections</h2><p class="integ-meta">${e.message}</p>`;
    }
  }

  async function refreshStatus() {
    document.getElementById('last-run').textContent = 'Loading…';
    document.getElementById('day-state').textContent = 'Loading…';
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'status failed');
      document.getElementById('last-run').textContent = JSON.stringify(
        data.state?.lastRun || { message: 'no runs yet' },
        null,
        2
      );
      document.getElementById('day-state').textContent = JSON.stringify(
        {
          stateBackend: data.stateBackend,
          baselineKey: data.state?.baselineKey,
          days: data.state?.days || {},
        },
        null,
        2
      );
    } catch (e) {
      document.getElementById('last-run').textContent = String(e.message || e);
      showMessage(String(e.message || e), true);
    }
  }

  async function triggerRun(dryRun) {
    showMessage(dryRun ? 'Starting dry run…' : 'Starting live run…');
    try {
      const res = await fetch('/api/run-daily', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      showMessage(
        dryRun
          ? `Dry run ok — ${data.results?.length || 0} day(s)`
          : `Run ok — ${data.results?.length || 0} day(s)`
      );
      await refreshStatus();
      await refreshIntegrations();
    } catch (e) {
      showMessage(String(e.message || e), true);
    }
  }

  document.getElementById('btn-refresh').addEventListener('click', () => {
    refreshStatus();
    refreshIntegrations();
  });
  document.getElementById('btn-dry').addEventListener('click', () => triggerRun(true));
  document.getElementById('btn-run').addEventListener('click', () => {
    if (!confirm('Post to Teams for any due EOD days as the connected user?')) return;
    triggerRun(false);
  });

  refreshStatus();
  refreshIntegrations();
}

function renderIntegrationsHub() {
  app.innerHTML = `
    <main class="page">
      ${navHtml('/integrations')}
      <header class="hero">
        <p class="brand">Integrations</p>
        <h1>Connect Slack &amp; Teams</h1>
        <p class="sub">User OAuth — tokens are encrypted and stored in this project. All EOD actions run as the connected user.</p>
      </header>
      <section class="card-grid" id="cards">
        <div class="panel integ-card"><p class="integ-meta">Loading…</p></div>
      </section>
    </main>
  `;
  loadCards();
}

async function loadCards() {
  const cards = document.getElementById('cards');
  try {
    const data = await fetchIntegrations();
    cards.innerHTML = `
      <div class="panel integ-card">
        <h3>Slack ${badge(data.slack?.status)}</h3>
        <p class="integ-meta">
          ${data.slack?.user || 'Not connected'}
          ${data.slack?.team ? `· ${data.slack.team}` : ''}
          ${data.slack?.expiresAt ? `<br/>Expires: ${data.slack.expiresAt}` : ''}
        </p>
        <a class="button" href="/integrations/slack">${data.slack?.status === 'connected' ? 'Manage' : 'Connect Slack'}</a>
      </div>
      <div class="panel integ-card">
        <h3>Teams ${badge(data.teams?.status)}</h3>
        <p class="integ-meta">
          ${data.teams?.user || 'Not connected'}
          ${data.teams?.expiresAt ? `<br/>Expires: ${data.teams.expiresAt}` : ''}
        </p>
        <a class="button" href="/integrations/teams">${data.teams?.status === 'connected' ? 'Manage' : 'Connect Teams'}</a>
      </div>`;
  } catch (e) {
    cards.innerHTML = `<div class="panel"><p class="integ-meta">${e.message}</p></div>`;
  }
}

function renderProviderPage(provider) {
  const title = provider === 'slack' ? 'Slack' : 'Microsoft Teams';
  const startUrl =
    provider === 'slack' ? '/api/oauth/slack/start' : '/api/oauth/teams/start';
  const active =
    provider === 'slack' ? '/integrations/slack' : '/integrations/teams';
  const ok = qs('ok');
  const error = qs('error');

  app.innerHTML = `
    <main class="page">
      ${navHtml(active)}
      <header class="hero">
        <p class="brand">${title} OAuth</p>
        <h1>Authenticate as user</h1>
        <p class="sub">
          No bot posting. Connect with your ${title} account. After auth, tokens are saved into
          <code>.env</code> (gitignored) and used for all ${title} actions.
        </p>
      </header>
      <section class="panel" id="provider-panel">
        <p class="integ-meta">Loading status…</p>
      </section>
      ${ok ? `<p class="message">Connected successfully.</p>` : ''}
      ${error ? `<p class="message error">${decodeURIComponent(error)}</p>` : ''}
      <section class="panel">
        <div class="row">
          <label for="secret">Run secret (for disconnect)</label>
          <input id="secret" type="password" placeholder="RUN_SECRET" autocomplete="off" />
        </div>
        <div class="actions">
          <a class="button" href="${startUrl}" id="btn-connect">Connect / Reconnect</a>
          <button type="button" id="btn-disconnect" class="secondary">Disconnect</button>
        </div>
        <p id="message" class="message" hidden></p>
      </section>
    </main>
  `;

  const secretEl = document.getElementById('secret');
  secretEl.value = getSecret();
  secretEl.addEventListener('change', () => setSecret(secretEl.value));

  async function refresh() {
    const panel = document.getElementById('provider-panel');
    try {
      const data = await fetchIntegrations();
      const row = data[provider] || {};
      panel.innerHTML = `
        <h2>Status ${badge(row.status)}</h2>
        <p class="integ-meta">
          User: ${row.user || '—'}<br/>
          ${provider === 'slack' ? `Workspace: ${row.team || '—'}<br/>` : ''}
          Expires: ${row.expiresAt || 'n/a (until revoked)'}
        </p>`;
      const btn = document.getElementById('btn-connect');
      btn.textContent =
        row.status === 'connected' ? 'Reconnect' : row.status === 'expired' ? 'Re-authenticate' : 'Connect';
    } catch (e) {
      panel.innerHTML = `<p class="integ-meta">${e.message}</p>`;
    }
  }

  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    const messageEl = document.getElementById('message');
    try {
      const res = await fetch('/api/integrations/disconnect', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'disconnect failed');
      messageEl.hidden = false;
      messageEl.classList.remove('error');
      messageEl.textContent = `${title} disconnected.`;
      refresh();
    } catch (e) {
      messageEl.hidden = false;
      messageEl.classList.add('error');
      messageEl.textContent = String(e.message || e);
    }
  });

  refresh();
}

function route() {
  const p = path();
  if (p === '/integrations/slack') return renderProviderPage('slack');
  if (p === '/integrations/teams') return renderProviderPage('teams');
  if (p === '/integrations') return renderIntegrationsHub();
  return renderHome();
}

window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (href.startsWith('/') && !href.startsWith('/api/')) {
    e.preventDefault();
    history.pushState({}, '', href);
    route();
  }
});

route();
