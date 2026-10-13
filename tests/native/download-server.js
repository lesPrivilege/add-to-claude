import http from 'node:http';
import { writeFile } from 'node:fs/promises';
const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/redirect') {
    response.writeHead(302, { location: '/ok' });
    response.end();
    return;
  }
  response.setHeader('Content-Type', path === '/html' ? 'text/html' : 'text/markdown');
  response.setHeader('Content-Disposition', 'attachment; filename="notes.md"');
  if (path === '/oversize') {
    // No Content-Length: exercise completed-byte enforcement, not just declared metadata.
    response.write(Buffer.alloc(5 * 1024 * 1024, 97));
    response.end('one byte over');
    return;
  }
  if (path === '/interrupted') {
    response.setHeader('Content-Length', '50000');
    response.write('partial');
    setTimeout(() => response.destroy(), 30);
    return;
  }
  if (path === '/slow') {
    setTimeout(() => response.end('Synthetic **download** 中文 ✓\n'), 200);
    return;
  }
  response.end(path === '/html' ? '<html>Sign in first</html>' : 'Synthetic **download** 中文 ✓\n');
});
server.listen(0, '127.0.0.1', async () => {
  await writeFile(process.argv[2], String(server.address().port));
});
process.on('SIGTERM', () => server.closeAllConnections() || server.close());
