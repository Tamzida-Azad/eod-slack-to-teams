/**
 * Format Slack #calysta-eod messages into Teams EOD Updates text + HTML.
 *
 * Rules (locked with user):
 * - Header: EOD Updates + MM/DD/YYYY
 * - Bold member names (Slack display name)
 * - Ticket lines (#1234): split on " - "; nest status segments; blank line before each ticket task
 * - Name-like mid segments (e.g. Juniper Brown) stay in title
 * - Simple bullets (no #ticket): compact, no blank lines between them
 * - Blank line between members
 * - Footer: italic EOD Automation · Scheduled by Cursor
 */

function dhakaDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    mmddyyyy: `${parts.month}/${parts.day}/${parts.year}`,
  };
}

function isTicketText(text) {
  return /#\d+/.test(String(text || ''));
}

function isNoiseLine(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (/^EOD:?$/i.test(t)) return true;
  // "Alauddin Rezvi (03/09/2026):"
  if (/^.+\(\d{1,2}\/\d{1,2}\/\d{4}\)\s*:?\s*$/.test(t)) return true;
  return false;
}

function isStatusLike(segment) {
  const s = String(segment || '').trim();
  if (!s) return false;
  if (
    /\b(fixed|done|progress|passed|deployed|working|will|sent|after|recurring|verified|retested|quick|live issue|configure|export)\b/i.test(
      s
    )
  ) {
    return true;
  }
  // Short proper-name style → keep in title (e.g. Juniper Brown)
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 3 && /^[A-Za-z]/.test(s) && !/[#|:]/.test(s)) {
    return false;
  }
  return true;
}

function splitHyphenParts(line) {
  return String(line)
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseTaskLine(line) {
  let raw = String(line || '').trim();
  // Leading bullet chars from Slack paste
  raw = raw.replace(/^[•●▪‣*\-]+\s*/, '');
  // Trailing lone hyphen from "Calling Agent -"
  const trailingHyphen = /\s+-\s*$/.test(raw);
  raw = raw.replace(/\s+-\s*$/, '').trim();

  const parts = splitHyphenParts(raw);
  if (parts.length === 0) return null;

  if (parts.length === 1 && !trailingHyphen) {
    return {
      title: parts[0],
      nested: [],
      ticketed: isTicketText(parts[0]),
    };
  }

  let titleParts = [parts[0]];
  let i = 1;
  if (isTicketText(parts[0])) {
    while (i < parts.length && !isStatusLike(parts[i])) {
      titleParts.push(parts[i]);
      i++;
    }
  }
  return {
    title: titleParts.join(' - '),
    nested: parts.slice(i),
    ticketed: isTicketText(parts[0]),
  };
}

function linesFromBody(body) {
  return String(body || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Convert one person's message body into task objects.
 */
function bodyToTasks(body) {
  const lines = linesFromBody(body).filter((l) => !isNoiseLine(l));
  const tasks = [];

  for (const line of lines) {
    const asNested = line.match(/^[-–—•]\s*(.+)$/);
    // Continuation nested under previous ticket (Rezvi style)
    if (asNested && tasks.length && !isTicketText(line)) {
      const text = asNested[1].trim();
      if (text) tasks[tasks.length - 1].nested.push(text);
      continue;
    }

    const task = parseTaskLine(line);
    if (task) tasks.push(task);
  }

  return tasks;
}

/**
 * @param {{ messages: Array<{ author: string, body: string, timestamp?: string }> }} scrape
 * @param {{ date?: Date, catchUp?: boolean, dateLabel?: string }} [options]
 */
function formatEod(scrape, options = {}) {
  const dateParts = dhakaDateParts(options.date || new Date());
  const dateLabel = options.dateLabel || dateParts.mmddyyyy;
  const byAuthor = new Map();

  for (const msg of scrape.messages || []) {
    const author = String(msg.author || '').trim() || 'Unknown';
    if (!byAuthor.has(author)) byAuthor.set(author, []);
    byAuthor.get(author).push(...bodyToTasks(msg.body));
  }

  const people = [...byAuthor.entries()].filter(([, tasks]) => tasks.length > 0);

  const header = `EOD Updates\n${dateLabel}`;
  const memberTexts = people.map(([name, tasks]) => {
    const lines = [`*${name}*`];
    let prevTicketed = false;
    tasks.forEach((task, idx) => {
      const needGap = idx > 0 && (task.ticketed || prevTicketed);
      if (needGap) lines.push(' '); // keep gap when Teams collapses empty lines
      lines.push(`  • ${task.title}`);
      for (const nest of task.nested) lines.push(`      - ${nest}`);
      prevTicketed = task.ticketed;
    });
    return lines.join('\n');
  });

  const FOOTER = options.catchUp
    ? `EOD Automation · Catch-up for ${dateLabel} · Scheduled by Cursor`
    : 'EOD Automation · Scheduled by Cursor';

  const payloadText = [
    header,
    ' ',
    ...interleaveBlank(memberTexts),
    ' ',
    `_${FOOTER}_`,
  ].join('\n');

  const payloadHtml = buildHtml(dateLabel, people, FOOTER);
  const blocks = buildBlocks(dateLabel, people, FOOTER);

  return {
    date: dateLabel,
    personCount: people.length,
    updateCount: people.reduce((n, [, t]) => n + t.length, 0),
    people: people.map(([name, tasks]) => ({ name, tasks })),
    payloadText,
    payloadHtml,
    blocks,
    catchUp: Boolean(options.catchUp),
  };
}

function interleaveBlank(sections) {
  const out = [];
  sections.forEach((s, i) => {
    if (i > 0) {
      out.push(' '); // non-empty blank line so Teams/plain paste keeps the gap
      out.push(' ');
    }
    out.push(s);
  });
  return out;
}

function buildHtml(mmddyyyy, people, footer) {
  // Teams collapses empty <br>/blank lines — use &nbsp; spacer lines so gaps survive paste.
  const spacer = '<div>&nbsp;</div>';
  const parts = [
    `<div><b>EOD Updates</b></div>`,
    `<div>${escapeHtml(mmddyyyy)}</div>`,
    spacer,
  ];

  people.forEach(([name, tasks], personIdx) => {
    if (personIdx > 0) {
      parts.push(spacer);
      parts.push(spacer);
    }
    parts.push(
      `<div><b><strong style="font-weight:700">${escapeHtml(name)}</strong></b></div>`
    );

    let prevTicketed = false;
    tasks.forEach((task, idx) => {
      const needGap = idx > 0 && (task.ticketed || prevTicketed);
      if (needGap) parts.push(spacer);
      parts.push(`<div>• ${escapeHtml(task.title)}</div>`);
      for (const nest of task.nested) {
        parts.push(`<div>&nbsp;&nbsp;&nbsp;&nbsp;- ${escapeHtml(nest)}</div>`);
      }
      prevTicketed = task.ticketed;
    });
  });

  parts.push(spacer);
  parts.push(`<div><i><em>${escapeHtml(footer)}</em></i></div>`);
  return parts.join('');
}

/** Structured lines for Teams typing (Ctrl+B / Ctrl+I). */
function buildBlocks(mmddyyyy, people, footer) {
  const blocks = [
    { style: 'bold', text: 'EOD Updates' },
    { style: 'normal', text: mmddyyyy },
    { style: 'spacer' },
  ];

  people.forEach(([name, tasks], personIdx) => {
    if (personIdx > 0) {
      blocks.push({ style: 'spacer' });
      blocks.push({ style: 'spacer' });
    }
    blocks.push({ style: 'bold', text: name });

    let prevTicketed = false;
    tasks.forEach((task, idx) => {
      const needGap = idx > 0 && (task.ticketed || prevTicketed);
      if (needGap) blocks.push({ style: 'spacer' });
      blocks.push({ style: 'normal', text: `• ${task.title}` });
      for (const nest of task.nested) {
        blocks.push({ style: 'normal', text: `    - ${nest}` });
      }
      prevTicketed = task.ticketed;
    });
  });

  blocks.push({ style: 'spacer' });
  blocks.push({ style: 'italic', text: footer });
  return blocks;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  formatEod,
  bodyToTasks,
  parseTaskLine,
  dhakaDateParts,
  isNoiseLine,
  isTicketText,
};

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const config = require('./config');
  const scrape = JSON.parse(fs.readFileSync(config.paths.messagesJson, 'utf8'));
  const formatted = formatEod(scrape);
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  fs.writeFileSync(config.paths.payloadTxt, formatted.payloadText, 'utf8');
  fs.writeFileSync(config.paths.payloadHtml, formatted.payloadHtml, 'utf8');
  console.log(formatted.payloadText);
  console.log('\nWrote', config.paths.payloadTxt);
}
