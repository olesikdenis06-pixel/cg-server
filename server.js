// Chicken Gun — сервер для игры с друзьями (WebSocket-ретранслятор).
// Запуск:  npm install  →  node server.js   (порт по умолчанию 3000)
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX = 16;
const rooms = new Map(); // имя комнаты -> { map, players: Map(id -> игрок) }
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Chicken Gun server работает. Игроков онлайн: ' +
    [...rooms.values()].reduce((n, r) => n + r.players.size, 0));
});
const wss = new WebSocketServer({ server });

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const others = (room, id, o) => {
  for (const p of room.players.values()) if (p.id !== id) send(p.ws, o);
};
const everyone = (room, o) => { for (const p of room.players.values()) send(p.ws, o); };

wss.on('connection', (ws) => {
  let me = null, room = null, roomName = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      if (me) return;
      roomName = String(m.room || 'main').slice(0, 32);
      room = rooms.get(roomName);
      if (!room) { room = { map: String(m.map || 'Base01'), players: new Map() }; rooms.set(roomName, room); }
      if (room.players.size >= MAX) { send(ws, { t: 'full' }); ws.close(); return; }
      me = { id: nextId++, ws, name: String(m.name || 'Игрок').slice(0, 20), look: m.look || {}, s: null, dead: false };
      send(ws, {
        t: 'welcome', id: me.id, map: room.map,
        players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, look: p.look, s: p.s })),
      });
      room.players.set(me.id, me);
      others(room, me.id, { t: 'join', p: { id: me.id, name: me.name, look: me.look } });
      console.log(`+ ${me.name} → «${roomName}» (${room.players.size})`);
      return;
    }
    if (!me) return;

    switch (m.t) {
      case 'm': // позиция
        m.id = me.id; me.s = m;
        if (me.dead && m.h >= 50) { me.dead = false; others(room, me.id, { t: 'respawn', id: me.id }); }
        if (!me.dead) others(room, me.id, m);
        break;
      case 'shot':
        others(room, me.id, { t: 'shot', id: me.id, o: m.o, d: m.d, w: m.w });
        break;
      case 'hit': { // урон другому игроку
        const target = room.players.get(m.to);
        if (target && !target.dead) {
          send(target.ws, { t: 'hit', from: me.id, d: m.d, head: m.head, imp: m.imp, gib: m.gib });
        }
        break;
      }
      case 'dead':
        if (me.dead) break;
        me.dead = true;
        everyone(room, { t: 'dead', id: me.id, by: m.by, gib: m.gib, head: m.head, imp: m.imp });
        break;
      case 'look':
        me.look = m.look || {};
        others(room, me.id, { t: 'look', id: me.id, look: me.look });
        break;
      case 'chat':
        everyone(room, { t: 'chat', id: me.id, name: me.name, d: String(m.d || '').slice(0, 80) });
        break;
    }
  });

  ws.on('close', () => {
    if (!me || !room) return;
    room.players.delete(me.id);
    others(room, me.id, { t: 'left', id: me.id });
    console.log(`- ${me.name} ← «${roomName}» (${room.players.size})`);
    if (!room.players.size) rooms.delete(roomName);
  });
});

// выкидываем зависшие соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
