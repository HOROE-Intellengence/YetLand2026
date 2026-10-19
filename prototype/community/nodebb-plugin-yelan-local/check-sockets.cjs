// Executed inside the isolated NodeBB container; never logs session values.
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
(async () => {
  const response = await fetch('http://bridge:3038/api/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'b' }),
  });
  assert.equal(response.status, 200);
  let cookie = response.headers.getSetCookie()[0].split(';')[0];
  const r = await fetch('http://localhost:4567/api/config', { headers: { Cookie: cookie } });
  for (const v of r.headers.getSetCookie()) cookie += `; ${v.split(';')[0]}`;
  const config = await r.json();
  assert(config.loggedIn);
  const socket = io('http://localhost:4567', {
    transports: ['websocket'],
    reconnection: false,
    query: { _csrf: config.csrf_token },
    extraHeaders: { Cookie: cookie, Origin: 'http://localhost:4567' },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket login timed out')), 6000);
      socket.on('checkSession', (uid) => {
        if (uid > 0) {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.on('connect_error', reject);
    });
    let disconnected = false;
    socket.on('disconnect', () => {
      disconnected = true;
    });
    const out = await fetch('http://bridge:3038/api/logout', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(out.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!disconnected) {
      socket.emit('meta.reconnected', {}, () => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert(disconnected, 'Revoked forum socket stayed connected');
    console.log('PASS Unified logout disconnects an already-open forum WebSocket');
  } finally {
    socket.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
