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
 * Type into Teams composer with real Ctrl+B / Ctrl+I so formatting survives send.
 * Enter sends the message in Teams — use Shift+Enter for newlines.
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

  // Clear draft
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isLast = i === blocks.length - 1;

    if (block.style === 'spacer') {
      await page.keyboard.type(' ');
      if (!isLast) await page.keyboard.press('Shift+Enter');
      continue;
    }

    if (block.style === 'bold') {
      await page.keyboard.press('Control+B');
      await page.keyboard.type(block.text, { delay: 5 });
      await page.keyboard.press('Control+B');
    } else if (block.style === 'italic') {
      await page.keyboard.press('Control+I');
      await page.keyboard.type(block.text, { delay: 5 });
      await page.keyboard.press('Control+I');
    } else {
      await page.keyboard.type(block.text, { delay: 2 });
    }

    if (!isLast) await page.keyboard.press('Shift+Enter');
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
    if (/sign in|enter password|pick an account/i.test(body.slice(0, 800)) && !/Chat|Calysta/i.test(body)) {
      throw new Error('Teams login wall — run save-auth in teams-slack-task-automation');
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
