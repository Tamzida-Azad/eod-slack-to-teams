const fs = require('fs');
const path = require('path');
const config = require('./config');

function loadPlaywright() {
  const candidates = [
    path.join(config.rootDir, 'node_modules', 'playwright'),
    path.join(config.rootDir, '..', 'teams-slack-task-automation', 'node_modules', 'playwright'),
    path.join(config.rootDir, '..', 'daily-head-start', 'node_modules', 'playwright'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // continue
    }
  }
  throw new Error('Playwright not found');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openTeamsChannel(page, channelName) {
  await page.keyboard.press('Escape').catch(() => {});
  const byName = page.getByRole('treeitem', {
    name: new RegExp(`^\\s*${escapeRegExp(channelName)}\\b`, 'i'),
  });
  if (await byName.count()) {
    await byName.first().click({ timeout: config.timeouts.action });
    await page.waitForTimeout(3000);
    return;
  }

  const matches = page
    .locator('[role="treeitem"]')
    .filter({ hasText: new RegExp(escapeRegExp(channelName), 'i') });
  const count = await matches.count();
  if (!count) {
    throw new Error(`Teams channel not found: ${channelName}`);
  }
  await matches.nth(count - 1).click({ timeout: config.timeouts.action });
  await page.waitForTimeout(3000);
}

/**
 * Teams treats ":)" / ":D" as emoji shortcodes while typing. That popup steals
 * caret/Enter handling so the next Shift+Enter may no-op — and the following
 * member name gets glued onto the previous bullet (e.g. "repos :) Alauddin Rezvi").
 * Convert shortcodes to Unicode so the picker never opens.
 */
function sanitizeForTeamsTyping(text) {
  return String(text || '')
    .replace(/:-\)/g, '🙂')
    .replace(/:\)/g, '🙂')
    .replace(/:-\(/g, '🙁')
    .replace(/:\(/g, '🙁')
    .replace(/:D/g, '😃')
    .replace(/;-?\)/g, '😉');
}

/**
 * Type one run with the keyboard only (Teams CKEditor-safe).
 *
 * Bold/italic: type → select line (Shift+Home) → Ctrl+B/I → End (collapse).
 * Do NOT use DOM insertNode/insertHTML here — those drop names or hit TrustedHTML.
 * Do NOT leave a selection when returning — Shift+Enter would eat the last char.
 * Do NOT press Escape after typing — it can blur the composer and drop later lines.
 */
async function typeWithStyle(page, text, style) {
  const value = sanitizeForTeamsTyping(text);
  if (!value) return;

  await page.keyboard.type(value, { delay: 3 });

  if (style !== 'bold' && style !== 'italic') return;

  await page.waitForTimeout(40);
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press(style === 'bold' ? 'Control+B' : 'Control+I');
  await page.keyboard.press('End');
  await page.waitForTimeout(40);

  const cmd = style === 'bold' ? 'bold' : 'italic';
  const stillOn = await page.evaluate((c) => {
    try {
      return document.queryCommandState(c);
    } catch {
      return false;
    }
  }, cmd);
  if (stillOn) {
    await page.keyboard.press(style === 'bold' ? 'Control+B' : 'Control+I');
  }
}

async function breakLine(page) {
  await page.keyboard.press('End');
  await page.waitForTimeout(40);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(40);
}

/**
 * Type into Teams composer. Enter sends — use Shift+Enter for newlines.
 * Never re-click the composer mid-loop (that resets caret and merges lines).
 */
async function typeBlocks(page, blocks) {
  const composer = page
    .locator(
      '[data-tid="ckeditor"], [aria-label*="Type a message"], [role="textbox"][contenteditable="true"], div[contenteditable="true"][data-tid]'
    )
    .first();
  await composer.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await composer.click();
  await page.waitForTimeout(200);

  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isLast = i === blocks.length - 1;

    if (block.style === 'spacer') {
      await page.keyboard.type(' ');
      if (!isLast) await breakLine(page);
      continue;
    }

    await typeWithStyle(page, block.text, block.style || 'normal');

    if (!isLast) await breakLine(page);
  }

  // Fail closed: each member name must appear on its own line (not glued after a bullet).
  const draft = (await composer.innerText().catch(() => '')) || '';
  const lines = draft
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
  const names = blocks
    .filter((b) => b.style === 'bold' && b.text && b.text !== 'EOD Updates')
    .map((b) => b.text);
  const bad = names.filter((n) => {
    const hit = lines.find((l) => l.includes(n));
    if (!hit) return true;
    if (/[•\-]/.test(hit)) return true;
    return hit !== n && !hit.startsWith(n);
  });
  if (bad.length) {
    throw new Error(
      `Teams draft member name(s) missing or merged into another line: ${bad.join(', ')} — aborting send. Draft lines: ${JSON.stringify(lines.slice(0, 20))}`
    );
  }
}

async function postToTeams(payloadText, payloadHtml, options = {}) {
  if (!payloadText || !payloadText.trim()) {
    throw new Error('Empty Teams payload');
  }

  const { chromium } = loadPlaywright();
  const headed = options.headed === true || process.env.EOD_HEADED === '1';
  const blocks = options.blocks || null;

  if (!fs.existsSync(config.paths.browserProfile)) {
    throw new Error(`Missing browser profile: ${config.paths.browserProfile}`);
  }

  const context = await chromium.launchPersistentContext(config.paths.browserProfile, {
    headless: !headed,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    await page.goto(config.teams.url, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(5000);

    const body = await page.locator('body').innerText().catch(() => '');
    const channelHint = config.teams.channelName.slice(0, 24);
    if (
      /sign in|enter password|pick an account/i.test(body.slice(0, 800)) &&
      !new RegExp(channelHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body)
    ) {
      throw new Error('Teams login wall — sign in on the Playwright browser profile (see README)');
    }

    await openTeamsChannel(page, config.teams.channelName);

    if (blocks && blocks.length) {
      await typeBlocks(page, blocks);
    } else {
      // Fallback: HTML insert (bold/italic less reliable)
      const composer = page
        .locator(
          '[data-tid="ckeditor"], [aria-label*="Type a message"], [role="textbox"][contenteditable="true"]'
        )
        .first();
      await composer.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await composer.click();
      const html = payloadHtml || plainToHtml(payloadText);
      await page.evaluate((html) => {
        const el =
          document.querySelector('[data-tid="ckeditor"]') ||
          document.querySelector('[role="textbox"][contenteditable="true"]');
        if (!el) return;
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        document.execCommand('insertHTML', false, html);
      }, html);
    }

    await page.waitForTimeout(500);

    const send = page.locator(
      '[data-tid="sendMessageCommands-send"], button[aria-label="Send"], button[aria-label="Send message"]'
    );
    if (await send.count()) {
      await send.first().click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(1500);

    return {
      mode: blocks ? 'typed-format' : 'browser',
      channel: config.teams.channelName,
    };
  } finally {
    await context.close();
  }
}

function plainToHtml(text) {
  return String(text)
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div>&nbsp;</div>';
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      let html = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');
      html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
      return `<div>${html}</div>`;
    })
    .join('');
}

module.exports = {
  postToTeams,
  plainToHtml,
  typeBlocks,
  typeWithStyle,
  sanitizeForTeamsTyping,
};

if (require.main === module) {
  const { formatEod } = require('./format-eod');
  const scrape = JSON.parse(fs.readFileSync(config.paths.messagesJson, 'utf8'));
  const formatted = formatEod(scrape);
  postToTeams(formatted.payloadText, formatted.payloadHtml, {
    headed: process.env.EOD_HEADED === '1',
    blocks: formatted.blocks,
  })
    .then((r) => console.log(r))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
