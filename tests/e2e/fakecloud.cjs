// In-memory key-value server behind the stand-in cloud (src/cloud/testBackend.ts).
// start() returns { url, close, dump }. Run directly for manual testing: node fakecloud.cjs 4555
const http = require('node:http');

function start(port = 0) {
  const store = new Map();
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/list') {
      const prefix = u.searchParams.get('prefix') || '';
      const out = [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, value: JSON.parse(v) }));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (u.pathname.startsWith('/kv/')) {
      const key = decodeURIComponent(u.pathname.slice(4));
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(store.has(key) ? store.get(key) : 'null'); }
      if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
      if (req.method === 'PUT') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { store.set(key, body); res.writeHead(204); res.end(); }); return; }
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
    dump: (prefix = '') => Object.fromEntries([...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, JSON.parse(v)])),
  })));
}
module.exports = { start };
if (require.main === module) start(Number(process.argv[2] || 4555)).then((s) => console.log('fake cloud on', s.url));
