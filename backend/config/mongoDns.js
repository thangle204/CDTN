import dns from 'node:dns';
import { isIP } from 'node:net';

const CONFIGURATION_MESSAGE = 'MONGO_DNS_SERVERS phải là tối đa 3 địa chỉ IP, phân cách bằng dấu phẩy.';
const configurationError = () => new TypeError(CONFIGURATION_MESSAGE);

// dns.setServers changes only this Node process's c-ares resolver (resolveSrv,
// resolveTxt, etc.). It does not change Windows DNS or dns.lookup's OS resolver.
// Validate the entire option before replacing any existing resolver settings.
export const configureMongoDns = (value = process.env.MONGO_DNS_SERVERS) => {
  if (value === undefined) return [];
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 256
    || /[\u0000-\u001f\u007f]/.test(value)) throw configurationError();
  if (!value.trim()) return [];

  const servers = [];
  for (const part of value.split(',')) {
    const address = part.trim();
    const version = isIP(address);
    if (!version || address.includes('%')) throw configurationError();
    // URL parsing normalizes equivalent IPv6 spellings without a DNS lookup.
    const normalized = version === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
    if (!servers.includes(normalized)) servers.push(normalized);
    if (servers.length > 3) throw configurationError();
  }

  try { dns.setServers(servers); }
  catch { throw configurationError(); }
  return servers;
};
