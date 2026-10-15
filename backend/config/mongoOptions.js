import tls from 'node:tls';

const customTrustOptions = new Set(['ca', 'securecontext', 'tlscafile']);

// Apply the operating system's trusted roots only to MongoDB sockets. Keep
// Node's default roots as well, including NODE_EXTRA_CA_CERTS when configured.
// Certificate-chain and hostname validation remain enabled by the driver.
export const mongoConnectionOptions = (uri, overrides = {}) => {
  const options = { ...overrides };
  const queryIndex = typeof uri === 'string' ? uri.indexOf('?') : -1;
  const uriOptions = new URLSearchParams(queryIndex < 0 ? '' : uri.slice(queryIndex + 1));
  const customTrust = Object.keys(options).some((key) => customTrustOptions.has(key.toLowerCase()))
    || [...uriOptions.keys()].some((key) => key.toLowerCase() === 'tlscafile');

  // An explicit trust store must retain its original meaning, including an
  // empty/null value. Older Node releases keep their normal TLS defaults.
  if (customTrust || typeof tls.getCACertificates !== 'function') return options;

  try {
    const ca = [...new Set([
      ...tls.getCACertificates('default'),
      ...tls.getCACertificates('system'),
    ])];
    if (ca.length) options.ca = ca;
  } catch {
    // Platforms without system-store support use Node's normal trusted roots.
  }
  return options;
};
