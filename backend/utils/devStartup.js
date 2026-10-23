import { createConnection } from 'node:net';
import { request } from 'node:http';
import { DEV_WORKSPACE_HEADER, devWorkspaceId } from './devWorkspace.js';

export const developmentPort = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new TypeError('Cổng phát triển phải là số nguyên từ 1 đến 65535.');
  }
  return Number(value);
};

const inspectListener = (host, port, timeoutMS) => new Promise(resolve => {
  let complete = false;
  let socket;
  const finish = state => {
    if (complete) return;
    complete = true;
    clearTimeout(timer);
    socket?.destroy();
    resolve({ host, state });
  };
  const timer = setTimeout(() => finish('blocked'), timeoutMS);
  socket = createConnection({ host, port });
  socket.once('connect', () => finish('occupied'));
  socket.once('error', error => finish(['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH'].includes(error.code)
    ? 'available' : 'blocked'));
});

// Only a matching workspace header counts as an already-running service.
// Never terminate an arbitrary process just because it owns a requested port.
const belongsToWorkspace = ({ port, pathname }, host, timeoutMS) => new Promise(resolve => {
  let complete = false;
  let outgoing;
  const finish = value => {
    if (complete) return;
    complete = true;
    clearTimeout(timer);
    outgoing?.destroy();
    resolve(value);
  };
  const timer = setTimeout(() => finish(false), timeoutMS);
  outgoing = request({ hostname: host, port, path: pathname, method: 'GET' }, response => {
    const matches = response.statusCode === 200 && response.headers[DEV_WORKSPACE_HEADER] === devWorkspaceId;
    response.destroy();
    finish(matches);
  });
  outgoing.once('error', () => finish(false));
  outgoing.end();
});

export const inspectDevelopmentServices = async (services, { timeoutMS = 2000 } = {}) => {
  if (!Array.isArray(services) || !Number.isInteger(timeoutMS) || timeoutMS < 1 || timeoutMS > 10000) {
    throw new TypeError('Cấu hình khởi động không hợp lệ.');
  }
  const ports = new Set();
  for (const service of services) {
    if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535 || ports.has(service.port)
      || typeof service.pathname !== 'string' || !service.pathname.startsWith('/')) {
      throw new TypeError('Các dịch vụ phải sử dụng cổng hợp lệ và khác nhau.');
    }
    ports.add(service.port);
  }
  return Promise.all(services.map(async service => {
    // Windows can allow a wildcard bind while a loopback-specific listener is
    // active. Probe IPv4 and IPv6 directly instead of treating that bind as free.
    const listeners = await Promise.all(['127.0.0.1', '::1']
      .map(host => inspectListener(host, service.port, timeoutMS)));
    if (listeners.some(listener => listener.state === 'blocked')) return { ...service, state: 'blocked' };
    const active = listeners.filter(listener => listener.state === 'occupied');
    if (!active.length) return { ...service, state: 'available' };
    const owned = await Promise.all(active.map(listener => belongsToWorkspace(service, listener.host, timeoutMS)));
    return { ...service, state: owned.every(Boolean) ? 'running' : 'blocked' };
  }));
};
