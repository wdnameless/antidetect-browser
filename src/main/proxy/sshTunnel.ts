// SSH dynamic tunnel: connects to an SSH server and exposes a local SOCKS5
// endpoint that forwards traffic through the SSH connection (ssh -D equivalent).
import { Client } from 'ssh2';
import { createSocks5Server, Socks5Server } from './socks5Server';

export interface SshTunnelConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
}

export interface SshTunnel {
  port: number;
  close: () => Promise<void>;
}

export async function createSshTunnel(cfg: SshTunnelConfig): Promise<SshTunnel> {
  const client = new Client();

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (err) => reject(err));
    client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username || 'root',
      password: cfg.password,
      privateKey: cfg.privateKey,
      readyTimeout: 15000,
    });
  });

  const socks = await createSocks5Server({
    connect: (host, port) =>
      new Promise((resolve, reject) => {
        client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      }),
  });

  return {
    port: socks.port,
    close: async () => {
      await socks.close();
      client.end();
    },
  };
}
