// Minimal SOCKS5 server (RFC 1928), CONNECT command only, no-auth.
// Used as the local endpoint of an SSH dynamic tunnel (ssh -D equivalent).
import * as net from 'net';
import { Duplex } from 'stream';

export type UpstreamConnector = (host: string, port: number) => Promise<Duplex>;

export interface Socks5Server {
  port: number;
  close: () => Promise<void>;
}

export interface Socks5ServerOptions {
  /** Custom upstream connector (e.g. SSH forwardOut). Defaults to net.connect. */
  connect?: UpstreamConnector;
}

export function createSocks5Server(options: Socks5ServerOptions = {}): Promise<Socks5Server> {
  const connect: UpstreamConnector = options.connect ?? ((host, port) => Promise.resolve(net.connect({ host, port })));

  const server = net.createServer((socket) => {
    socket.once('data', (greeting: Buffer) => {
      // greeting: VER(0x05) NMETHODS N METHODS...
      if (greeting.length < 2 || greeting[0] !== 0x05) {
        socket.destroy();
        return;
      }
      // Reply: no authentication required
      socket.write(Buffer.from([0x05, 0x00]));

      socket.once('data', (request: Buffer) => {
        if (request.length < 7 || request[0] !== 0x05 || request[1] !== 0x01) {
          socket.destroy();
          return;
        }
        const atyp = request[3];
        let host: string;
        let port: number;

        if (atyp === 0x01) {
          // IPv4
          if (request.length < 10) {
            socket.destroy();
            return;
          }
          host = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
          port = request.readUInt16BE(8);
        } else if (atyp === 0x03) {
          // Domain name
          const nameLen = request[4];
          if (request.length < 5 + nameLen + 2) {
            socket.destroy();
            return;
          }
          host = request.slice(5, 5 + nameLen).toString('utf8');
          port = request.readUInt16BE(5 + nameLen);
        } else if (atyp === 0x04) {
          // IPv6
          if (request.length < 22) {
            socket.destroy();
            return;
          }
          const parts: string[] = [];
          for (let i = 0; i < 8; i++) {
            parts.push(request.readUInt16BE(4 + i * 2).toString(16));
          }
          host = parts.join(':');
          port = request.readUInt16BE(20);
        } else {
          socket.destroy();
          return;
        }

        connect(host, port)
          .then((upstream) => {
            // Reply: success, BND.ADDR = 0.0.0.0:0
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            socket.pipe(upstream);
            upstream.pipe(socket);
            upstream.on('error', () => socket.destroy());
            socket.on('error', () => upstream.destroy());
          })
          .catch(() => {
            socket.destroy();
          });
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve({
          port: address.port,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => res());
            }),
        });
      } else {
        reject(new Error('failed to bind socks5 server'));
      }
    });
  });
}
