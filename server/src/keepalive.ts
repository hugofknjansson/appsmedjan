import type { WebSocket } from 'ws';

/**
 * Pings a connection regularly and drops it when the other side stops answering.
 * Reverse proxies and hosting platforms close connections that are silent for about a minute; without
 * this an idle build worker would be cut off, reconnect, and shut its simulators down every time.
 */
export function keepAlive(ws: WebSocket, everyMs = 25_000): void {
  let answered = true;
  ws.on('pong', () => {
    answered = true;
  });
  const timer = setInterval(() => {
    if (!answered) {
      ws.terminate();
      return;
    }
    answered = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }, everyMs);
  ws.on('close', () => clearInterval(timer));
}
