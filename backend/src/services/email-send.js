/**
 * emailSend content tool — send email and optional calendar/meeting invites.
 */
import { randomUUID } from 'crypto';
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';
import { smtpFromEnv } from './agent-workflow-tasks.js';

function normalizeRecipients(value) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return [...new Set(list.map((v) => String(v || '').trim()).filter(Boolean))];
}

function resolveSmtpConfig(body = {}) {
  if (body.useEnvSmtp !== false) {
    const env = smtpFromEnv();
    return {
      host: body.smtpHost || env.host,
      port: Number(body.smtpPort || env.port || 587),
      secure: body.smtpSecure ?? env.secure,
      user: body.smtpUser || env.user,
      pass: body.smtpPass || env.pass,
      from: body.from || body.fromAddress || env.from,
    };
  }
  return {
    host: body.smtpHost || '',
    port: Number(body.smtpPort || 587),
    secure: !!body.smtpSecure,
    user: body.smtpUser || '',
    pass: body.smtpPass || '',
    from: body.from || body.fromAddress || body.smtpUser || 'agent-os@localhost',
  };
}

function formatIcsDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid calendar date: ${iso}`);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseEmailAddress(value) {
  const raw = String(value || '').trim();
  const angle = raw.match(/<([^>]+)>/);
  const email = (angle ? angle[1] : raw).trim().toLowerCase();
  const nameMatch = raw.match(/^([^<]+)</);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : '';
  return { email, name: name || email.split('@')[0] || 'Organizer' };
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

const ICS_BLOCK_RE = /BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i;

function parseIcsProperty(ics, name) {
  const re = new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, 'im');
  const m = String(ics || '').match(re);
  return m ? m[1].trim() : '';
}

/** Convert common ICS datetime forms to ISO 8601 for buildCalendarInvite. */
export function icsDateValueToIso(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
  const zulu = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i);
  if (zulu) {
    return `${zulu[1]}-${zulu[2]}-${zulu[3]}T${zulu[4]}:${zulu[5]}:${zulu[6]}Z`;
  }
  const local = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (local) {
    return `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6]}`;
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return v;
}

/** Parse minimal fields from pasted/hallucinated ICS text. */
export function parseIcsBlock(icsText) {
  const ics = String(icsText || '').trim();
  if (!ics) return null;
  const title = parseIcsProperty(ics, 'SUMMARY');
  const start = icsDateValueToIso(parseIcsProperty(ics, 'DTSTART'));
  const end = icsDateValueToIso(parseIcsProperty(ics, 'DTEND'));
  if (!title || !start || !end) return null;
  return {
    title,
    start,
    end,
    description: parseIcsProperty(ics, 'DESCRIPTION'),
    location: parseIcsProperty(ics, 'LOCATION'),
  };
}

/**
 * Agents sometimes paste BEGIN:VCALENDAR… into email body instead of using calendar JSON.
 * Strip it from the body and rebuild a proper invite from parsed fields when possible.
 */
export function extractIcsFromPlainBody(textBody) {
  const raw = String(textBody || '');
  const match = raw.match(ICS_BLOCK_RE);
  if (!match) return { body: raw.trim(), icsText: null, parsed: null };
  const icsText = match[0];
  const cleaned = raw.replace(ICS_BLOCK_RE, '').trim();
  const parsed = parseIcsBlock(icsText);
  return {
    body: cleaned || (parsed?.title ? `Calendar invitation: ${parsed.title}` : 'Please see the attached calendar invite.'),
    icsText,
    parsed,
  };
}

function guessContentType(filename, explicit) {
  if (explicit) return explicit;
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.ics')) return 'text/calendar; method=REQUEST; charset=utf-8';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/** Normalize attachments from body.attachments, body.attachment, or ics shortcuts. */
export function normalizeAttachments(body = {}) {
  const raw = [];
  if (Array.isArray(body.attachments)) raw.push(...body.attachments);
  else if (body.attachments && typeof body.attachments === 'object') raw.push(body.attachments);
  if (body.attachment) raw.push(body.attachment);

  const icsRaw = body.ics ?? body.ics_content ?? body.ics_file ?? body.icsAttachment ?? null;
  if (icsRaw != null && icsRaw !== '') {
    if (typeof icsRaw === 'object' && !Array.isArray(icsRaw)) {
      raw.push({
        filename: icsRaw.filename || body.ics_filename || 'invite.ics',
        content: icsRaw.content ?? icsRaw.data ?? icsRaw.body ?? '',
        contentType: icsRaw.contentType || icsRaw.content_type || 'text/calendar; method=REQUEST; charset=utf-8',
        encoding: icsRaw.encoding || icsRaw.contentTransferEncoding,
      });
    } else {
      raw.push({
        filename: body.ics_filename || 'invite.ics',
        content: String(icsRaw),
        contentType: 'text/calendar; method=REQUEST; charset=utf-8',
      });
    }
  }

  return raw.map(normalizeOneAttachment).filter(Boolean);
}

function normalizeOneAttachment(att) {
  if (att == null || att === '') return null;
  if (typeof att === 'string') {
    return {
      filename: 'invite.ics',
      content: att,
      contentType: 'text/calendar; method=REQUEST; charset=utf-8',
      encoding: '8bit',
      disposition: 'attachment',
    };
  }
  const filename = String(att.filename || att.name || 'attachment').trim() || 'attachment';
  const content = att.content ?? att.data ?? att.body ?? att.text ?? '';
  if (content === '' || content == null) return null;
  const encoding =
    att.encoding || att.contentTransferEncoding || (att.base64 ? 'base64' : '8bit');
  const contentType = guessContentType(filename, att.contentType || att.content_type || att.mimeType || att.mime_type);
  const disposition = att.disposition || (filename.endsWith('.ics') ? 'attachment' : 'attachment');
  return {
    filename,
    content: typeof content === 'string' ? content : String(content),
    contentType,
    encoding: encoding === 'base64' ? 'base64' : '8bit',
    disposition,
  };
}

function encodeAttachmentPart(att) {
  if (att.encoding === 'base64') {
    const cleaned = att.content.replace(/\s/g, '');
    const wrapped = cleaned.match(/.{1,76}/g)?.join('\r\n') || cleaned;
    return wrapped;
  }
  return att.content;
}

export function buildCalendarInvite({
  title,
  start,
  end,
  location = '',
  description = '',
  organizer = '',
  attendees = [],
  uid = null,
}) {
  if (!title || !start || !end) {
    throw new Error('Calendar invite requires title, start, and end (ISO 8601)');
  }
  const eventUid = uid || `agent-os-${randomUUID()}@agent-os`;
  const org = parseEmailAddress(organizer);
  const orgEmail = org.email;
  const allAttendees = normalizeRecipients(attendees);
  const externalAttendees = allAttendees.filter((a) => a.toLowerCase() !== orgEmail);
  // Gmail rejects METHOD:REQUEST when organizer and attendee are the same address.
  const method = externalAttendees.length > 0 ? 'REQUEST' : 'PUBLISH';
  const now = formatIcsDate(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agent OS//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${eventUid}`,
    `DTSTAMP:${now}`,
    `CREATED:${now}`,
    `LAST-MODIFIED:${now}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'CLASS:PUBLIC',
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  if (orgEmail) {
    lines.push(`ORGANIZER;CN=${escapeIcsText(org.name)};RSVP=FALSE:mailto:${orgEmail}`);
  }
  for (const attendee of externalAttendees) {
    const guest = parseEmailAddress(attendee);
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${escapeIcsText(guest.name)}:mailto:${guest.email}`
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR', '');
  return { ics: lines.join('\r\n'), uid: eventUid, method };
}

function base64MimeContent(text) {
  const b64 = Buffer.from(String(text), 'utf8').toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') || b64;
}

function buildIcsAttachmentPart(ics, filename, method = 'REQUEST') {
  const safeName = String(filename || 'invite.ics').replace(/"/g, '');
  return {
    filename: safeName,
    content: base64MimeContent(ics),
    contentType: `text/calendar; method=${method}; charset=UTF-8; name="${safeName}"`,
    encoding: 'base64',
    disposition: 'attachment',
  };
}

function buildTextHtmlBodyParts(textBody, htmlBody, outerBoundary) {
  const text = String(textBody || '').trim() || '(See HTML version)';
  const html = String(htmlBody || '').trim();
  if (!html) {
    return [
      `--${outerBoundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      '',
    ];
  }
  const altBoundary = `alt-${randomUUID()}`;
  return [
    `--${outerBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${altBoundary}--`,
    '',
  ];
}

function buildMimeMessage({
  from,
  toList,
  ccList,
  bccList,
  subject,
  body,
  html = null,
  ics = null,
  meetingTitle = null,
  calendarInviteMethod = 'REQUEST',
  attachments = [],
}) {
  const messageId = `<agent-os.${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${String(from).split('@')[1] || 'localhost'}>`;
  const headers = [
    `From: ${from}`,
    `To: ${toList.join(', ')}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Reply-To: ${from}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];

  const hasInlineCalendar = !!ics;
  const fileAttachments = attachments.filter((a) => a && a.content);
  const hasAttachments = fileAttachments.length > 0;
  const htmlBody = html != null && String(html).trim() ? String(html).trim() : null;

  if (hasInlineCalendar) {
    headers.push('Content-Class: urn:content-classes:calendarmessage');
  }

  // Plain + optional HTML, no attachments/calendar.
  if (!hasInlineCalendar && !hasAttachments) {
    if (!htmlBody) {
      headers.push('Content-Type: text/plain; charset=utf-8');
      return { message: [...headers, '', body].join('\r\n'), messageId };
    }
    const altBoundary = `alt-${randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    const parts = [
      `--${altBoundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body || '(See HTML version)',
      '',
      `--${altBoundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlBody,
      '',
      `--${altBoundary}--`,
      '',
    ];
    return { message: [...headers, '', ...parts].join('\r\n'), messageId };
  }

  const mixedBoundary = `mixed-${randomUUID()}`;

  // Gmail reliably parses calendar invites as base64 .ics attachments in multipart/mixed.
  if (hasInlineCalendar) {
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const icsFilename = `${(meetingTitle || 'invite').replace(/[^\w.-]+/g, '_') || 'invite'}.ics`;
    const calendarMethod = calendarInviteMethod || 'REQUEST';
    const icsPart = buildIcsAttachmentPart(ics, icsFilename, calendarMethod);
    const parts = [
      ...buildTextHtmlBodyParts(body, htmlBody, mixedBoundary),
      `--${mixedBoundary}`,
      `Content-Type: ${icsPart.contentType}`,
      `Content-Disposition: attachment; filename="${icsPart.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      icsPart.content,
      '',
    ];
    for (const att of fileAttachments) {
      const safeName = att.filename.replace(/"/g, '');
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.contentType}; name="${safeName}"`,
        `Content-Disposition: ${att.disposition || 'attachment'}; filename="${safeName}"`,
        `Content-Transfer-Encoding: ${att.encoding === 'base64' ? 'base64' : '8bit'}`,
        '',
        encodeAttachmentPart(att),
        ''
      );
    }
    parts.push(`--${mixedBoundary}--`, '');
    return { message: [...headers, '', ...parts].join('\r\n'), messageId };
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts = [...buildTextHtmlBodyParts(body || '(See attachment)', htmlBody, mixedBoundary)];
  for (const att of fileAttachments) {
    const safeName = att.filename.replace(/"/g, '');
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${safeName}"`,
      `Content-Disposition: ${att.disposition || 'attachment'}; filename="${safeName}"`,
      `Content-Transfer-Encoding: ${att.encoding === 'base64' ? 'base64' : '8bit'}`,
      '',
      encodeAttachmentPart(att),
      ''
    );
  }
  parts.push(`--${mixedBoundary}--`, '');
  return { message: [...headers, '', ...parts].join('\r\n'), messageId };
}

function isSmtpReplyComplete(line) {
  return line.length >= 4 && line[3] === ' ';
}

function isSmtpSuccess(code) {
  return code >= 200 && code < 300;
}

function sendSmtpMime({ host, port, secure, user, pass, from, toList, ccList, bccList, message }) {
  return new Promise((resolve) => {
    const allRecipients = [...new Set([...toList, ...ccList, ...bccList])];
    if (!host) {
      return resolve({ sent: false, attempted: true, error: 'SMTP host not configured (set WORKFLOW_SMTP_HOST)', messageId: null });
    }
    if (!allRecipients.length) {
      return resolve({ sent: false, attempted: false, error: 'At least one recipient is required', messageId: null });
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ sent: false, attempted: true, error: 'SMTP connection timeout', messageId: null });
    }, 20000);

    let socket;
    let buffer = '';
    let stage = 'connect';
    let finished = false;
    let recipientIndex = 0;
    const useStartTls = port === 587 && !(secure && port === 465);

    function cleanup() {
      clearTimeout(timeout);
      try {
        socket?.destroy();
      } catch (_) {}
    }

    function fail(err) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ sent: false, attempted: true, error: err, messageId: null });
    }

    function succeed(messageId, smtpReply) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ sent: true, attempted: true, error: null, messageId, smtpReply: smtpReply || null });
    }

    function send(line) {
      socket.write(`${line}\r\n`);
    }

    function beginAuthOrMail() {
      if (user && pass) {
        send('AUTH LOGIN');
        stage = 'auth-user';
      } else {
        send(`MAIL FROM:<${from}>`);
        stage = 'mail-from';
      }
    }

    function sendNextRcpt() {
      if (recipientIndex >= allRecipients.length) {
        send('DATA');
        stage = 'data-wait';
        return;
      }
      send(`RCPT TO:<${allRecipients[recipientIndex]}>`);
      recipientIndex += 1;
      stage = 'rcpt';
    }

    function onSmtpLine(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (Number.isNaN(code)) return;
      if (!isSmtpReplyComplete(line) && code !== 334 && code !== 354) return;

      if (stage === 'connect' && code === 220) {
        send('EHLO agent-os');
        stage = 'ehlo';
      } else if ((stage === 'ehlo' || stage === 'ehlo-tls') && isSmtpSuccess(code)) {
        if (useStartTls && stage === 'ehlo') {
          send('STARTTLS');
          stage = 'starttls';
        } else {
          beginAuthOrMail();
        }
      } else if (stage === 'starttls' && code === 220) {
        socket.removeListener('data', onData);
        const plain = socket;
        socket = tlsConnect({ socket: plain, servername: host, rejectUnauthorized: false }, () => {
          socket.on('data', onData);
          send('EHLO agent-os');
          stage = 'ehlo-tls';
        });
        socket.on('error', (e) => fail(e.message));
      } else if (stage === 'auth-user' && code === 334) {
        send(Buffer.from(user).toString('base64'));
        stage = 'auth-pass';
      } else if (stage === 'auth-pass' && code === 334) {
        send(Buffer.from(pass).toString('base64'));
        stage = 'auth-wait';
      } else if (stage === 'auth-wait' && isSmtpSuccess(code)) {
        send(`MAIL FROM:<${from}>`);
        stage = 'mail-from';
      } else if (stage === 'mail-from' && isSmtpSuccess(code)) {
        sendNextRcpt();
      } else if (stage === 'rcpt' && isSmtpSuccess(code)) {
        sendNextRcpt();
      } else if (stage === 'data-wait' && code === 354) {
        send(message);
        send('.');
        stage = 'data-done';
      } else if (stage === 'data-done' && isSmtpSuccess(code)) {
        send('QUIT');
        const mid = line.match(/queued as (\S+)/i)?.[1] || line.match(/<([^>]+)>/)?.[1] || null;
        succeed(mid, line);
      } else if (code >= 400) {
        fail(line);
      }
    }

    function onData(data) {
      buffer += data.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        onSmtpLine(line);
      }
    }

    try {
      if (secure && port === 465) {
        socket = tlsConnect({ host, port, rejectUnauthorized: false }, () => {});
      } else {
        socket = createConnection({ host, port }, () => {});
      }
      socket.on('data', onData);
      socket.on('error', (e) => fail(e.message));
      socket.on('close', () => {
        if (!finished && stage !== 'data-done') fail(`Connection closed (${stage})`);
      });
    } catch (e) {
      fail(e.message);
    }
  });
}

/**
 * Send email and/or calendar invite.
 * Body: {
 *   to, cc?, bcc?, subject, body, html?,
 *   calendar?: { title, start, end, ... },
 *   attachments?: [{ filename, content, contentType?, encoding? }],
 *   ics?: string — raw .ics file content (shortcut)
 * }
 */
export async function executeEmailSend(body = {}) {
  const toList = normalizeRecipients(body.to);
  const ccList = normalizeRecipients(body.cc);
  const bccList = normalizeRecipients(body.bcc);
  const subject = String(body.subject || '').trim() || '(no subject)';
  let textBody = String(body.body || body.text || '').trim();
  const htmlBody = body.html != null ? String(body.html).trim() : '';
  let attachments = normalizeAttachments(body);

  if (!toList.length && !ccList.length && !bccList.length) {
    return { sent: false, attempted: false, error: 'At least one recipient (to, cc, or bcc) is required' };
  }

  const smtp = resolveSmtpConfig(body);
  let cal = body.calendar || body.meeting || null;
  let icsFromBody = false;

  if (!cal && ICS_BLOCK_RE.test(textBody)) {
    const extracted = extractIcsFromPlainBody(textBody);
    textBody = extracted.body;
    if (extracted.parsed) {
      cal = extracted.parsed;
      icsFromBody = true;
    } else if (extracted.icsText) {
      attachments.push({
        filename: 'invite.ics',
        content: extracted.icsText,
        contentType: 'text/calendar; method=REQUEST; charset=utf-8',
        encoding: '8bit',
        disposition: 'attachment',
      });
      icsFromBody = true;
    }
  } else if (cal && ICS_BLOCK_RE.test(textBody)) {
    textBody = extractIcsFromPlainBody(textBody).body;
  }

  if (!textBody && !htmlBody && !cal && !attachments.length) {
    return { sent: false, attempted: false, error: 'Email body, calendar invite, or attachment is required' };
  }

  let ics = null;
  let calendarUid = null;
  let calendarMethod = 'REQUEST';
  if (cal) {
    const built = buildCalendarInvite({
      title: cal.title || subject,
      start: cal.start || cal.startTime,
      end: cal.end || cal.endTime,
      location: cal.location,
      description: cal.description || textBody,
      organizer: cal.organizer || smtp.from,
      attendees: cal.attendees || [...toList, ...ccList],
    });
    ics = built.ics;
    calendarUid = built.uid;
    calendarMethod = built.method || 'REQUEST';
  }

  const { message, messageId: draftId } = buildMimeMessage({
    from: smtp.from,
    toList: toList.length ? toList : ccList,
    ccList: toList.length ? ccList : [],
    bccList,
    subject,
    body: textBody || (htmlBody ? '' : `Meeting invitation: ${cal?.title || subject}`),
    html: htmlBody || null,
    ics,
    meetingTitle: cal?.title || subject,
    calendarInviteMethod: calendarMethod,
    attachments,
  });

  const result = await sendSmtpMime({
    ...smtp,
    toList: toList.length ? toList : ccList,
    ccList: toList.length ? ccList : [],
    bccList,
    message,
  });

  const hasIcsAttachment = attachments.some((a) => /\.ics$/i.test(a.filename) || /calendar/i.test(a.contentType));

  return {
    sent: !!result.sent,
    attempted: !!result.attempted,
    error: result.error || null,
    messageId: result.messageId || draftId,
    smtpReply: result.smtpReply || null,
    to: toList,
    cc: ccList,
    bcc: bccList,
    subject,
    calendarSent: !!ics || hasIcsAttachment,
    calendarUid,
    calendarMethod,
    icsExtractedFromBody: icsFromBody,
    attachmentsSent: attachments.length + (ics ? 1 : 0),
    attachmentNames: attachments.map((a) => a.filename),
  };
}
