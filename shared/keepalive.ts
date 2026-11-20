import type { WebSocket } from 'ws';

/**
 * Pings a connection regularly and drops it when the other side stops answering.
 *
 * The server uses it because reverse proxies and hosting platforms close connections that are silent
 * for about a minute; without it an idle build worker would be cut off, reconnect, and shut its
 * simulators down every time.
 *
 * The worker uses it because a connection can die without either end being told (the server's machine
 * is stopped, the network changes, the Mac sleeps). The socket then looks open forever and the worker
 * never reconnects. Dropping it here fires 'close', which is what starts the reconnect.
 */
export function keepAlive(ws: WebSocket, everyMs = 25_000, onDead?: () => void): void {
  let answered = true;
  ws.on('pong', () => {
    answered = true;
  });
  const timer = setInterval(() => {
    if (!answered) {
      onDead?.();
      ws.terminate();
      return;
    }
    answered = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }, everyMs);
  ws.on('close', () => clearInterval(timer));
}
