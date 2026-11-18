import { createServer, type Socket } from 'node:net';

// A loopback SMTP receiver for the single disposable password-recovery test.
export async function recoveryMailbox(port: number, recipient: string) {
  if (!recipient.endsWith('@example.invalid')) throw Error('A disposable test address is required.');
  let delivered: (body: string) => void = () => {};
  const mail = new Promise<string>((resolve) => {
    delivered = resolve;
  });
  const clients = new Set<Socket>();
  const server = createServer((socket) => {
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(25_000, () => socket.destroy());
    socket.setEncoding('utf8');
    let buffer = '',
      body = '',
      reading = false,
      accepted = false;
    const reply = (line: string) => socket.write(line + '\r\n');
    reply('220 localhost test receiver');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length + body.length > 100_000) {
        socket.destroy();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (reading) {
          if (line !== '.') {
            body += line + '\r\n';
            continue;
          }
          reading = false;
          reply('250 Message accepted');
          delivered(body);
          continue;
        }
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO') reply('250-localhost\r\n250 8BITMIME');
        else if (command === 'RCPT') {
          accepted = line.toLowerCase().includes('<' + recipient + '>');
          reply(accepted ? '250 Recipient accepted' : '550 Unknown recipient');
        } else if (command === 'DATA' && accepted) {
          reading = true;
          body = '';
          reply('354 End with a single dot');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
          return;
        } else if (['HELO', 'MAIL', 'RSET', 'NOOP'].includes(command)) reply('250 OK');
        else reply('502 Command unavailable');
      }
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  return {
    mail,
    close: async () => {
      for (const socket of clients) socket.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
export function recoveryLink(raw: string) {
  const [headers, ...parts] = raw.split('\r\n\r\n'),
    body = parts.join('\r\n\r\n');
  const html = /content-transfer-encoding:\s*base64/i.test(headers)
    ? Buffer.from(body, 'base64').toString()
    : body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const match = /href=["']([^"']+)["']/i.exec(html);
  if (!match) throw Error('The local recovery email did not include a link.');
  const url = new URL(match[1].replaceAll('&amp;', '&'));
  if (url.origin !== 'http://127.0.0.1:4229' || url.pathname !== '/auth/v1/verify')
    throw Error('The recovery link did not point to the isolated Auth gateway.');
  return url.href;
}
