// lib/sse.js — Sistema eventi real-time (SSE + Socket.IO)
const sseClients = new Map();   // userId -> Set<res>
const ioClients = new Map();    // userId -> Set<socket>
const ssePending = new Map();   // userId -> [{event, data, ts}]

function ssePendingAdd(userId, event, data) {
  const uid = String(userId);
  if (!ssePending.has(uid)) ssePending.set(uid, []);
  const buf = ssePending.get(uid);
  buf.push({ event, data, ts: Date.now() });
  const cutoff = Date.now() - 120000;
  ssePending.set(uid, buf.filter(e => e.ts > cutoff).slice(-30));
}

let _io = null;
function setIO(io) { _io = io; }
function getIO() { return _io; }

// Emette su ENTRAMBI i canali: Socket.IO (prioritario) + SSE (fallback)
function sseEmit(userId, event, data) {
  const uid = String(userId);
  const BUFFER_EVENTS = ['call_invite','challenge_invite','live_started','call_answer','call_ice','challenge_started'];
  if (BUFFER_EVENTS.includes(event)) ssePendingAdd(userId, event, data);

  const ioSet = ioClients.get(uid);
  if (ioSet && ioSet.size) {
    for (const sock of ioSet) {
      try { sock.emit(event, data); } catch { ioSet.delete(sock); }
    }
  }

  const sseSet = sseClients.get(uid);
  if (sseSet && sseSet.size) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseSet) {
      try { res.write(payload); } catch { sseSet.delete(res); }
    }
  }
}

function sseBroadcast(event, data) {
  if (_io) _io.emit(event, data);
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, set] of sseClients) {
    for (const res of set) {
      try { res.write(payload); } catch { set.delete(res); }
    }
  }
}

module.exports = { sseClients, ioClients, ssePending, sseEmit, sseBroadcast, setIO, getIO };
