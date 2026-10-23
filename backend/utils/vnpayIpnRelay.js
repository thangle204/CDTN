import { createServer, request } from 'node:http';
import { DEV_WORKSPACE_HEADER, devWorkspaceId } from './devWorkspace.js';

const IPN_PATH = '/api/payments/vnpay/ipn';
const MAX_URL_BYTES = 8192;
const MAX_RESPONSE_BYTES = 4096;
const messages = Object.freeze({
  '00': 'Confirm Success',
  '01': 'Order not found',
  '02': 'Order already updated',
  '04': 'Invalid amount',
  '97': 'Invalid Signature',
  '99': 'Unable to record transaction',
});

const json = (res, status, body, headers = {}) => {
  if (res.destroyed || res.writableEnded) return;
  const content = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(content);
};

// A tunnel can point at this server without publishing the rest of the API.
// The target host, method and route are fixed; only the original query passes
// through so the API can reject duplicate fields and verify VNPAY's signature.
export const createVnpayIpnRelay = ({ apiPort = 5000, requestTimeoutMS = 5000 } = {}) => {
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new TypeError('Invalid local API port');
  }
  if (!Number.isInteger(requestTimeoutMS) || requestTimeoutMS < 1 || requestTimeoutMS > 60000) {
    throw new TypeError('Invalid IPN request timeout');
  }

  return createServer({ maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 10000 }, (req, res) => {
    if (process.env.NODE_ENV !== 'production') res.setHeader(DEV_WORKSPACE_HEADER, devWorkspaceId);
    req.resume();
    const rawUrl = req.url || '';
    if (Buffer.byteLength(rawUrl) > MAX_URL_BYTES) {
      return json(res, 414, { message: 'Request URL too long' });
    }
    if (rawUrl.split('?', 1)[0] !== IPN_PATH) {
      return json(res, 404, { message: 'Not found' });
    }
    if (req.method !== 'GET') {
      return json(res, 405, { message: 'Method not allowed' }, { Allow: 'GET' });
    }

    let completed = false;
    let timeout;
    let upstream;
    const finish = (code = '99') => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      upstream?.destroy();
      json(res, 200, { RspCode: code, Message: messages[code] });
    };
    res.once('close', () => {
      completed = true;
      clearTimeout(timeout);
      upstream?.destroy();
    });
    req.once('error', () => finish());

    upstream = request({
      hostname: '127.0.0.1', port: apiPort, method: 'GET', path: rawUrl,
      headers: { Accept: 'application/json' },
      maxHeaderSize: 8192,
    }, (response) => {
      const contentType = response.headers['content-type'] || '';
      if (response.statusCode !== 200 || !/^application\/json\s*(?:;|$)/i.test(contentType)
        || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy();
        return finish();
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy();
          finish();
        } else chunks.push(chunk);
      });
      response.once('error', () => finish());
      response.once('aborted', () => finish());
      response.once('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const code = body && !Array.isArray(body) && typeof body.RspCode === 'string'
            && Object.hasOwn(messages, body.RspCode) ? body.RspCode : '99';
          finish(code);
        } catch { finish(); }
      });
    });
    upstream.once('error', () => finish());
    timeout = setTimeout(() => finish(), requestTimeoutMS);
    upstream.end();
  });
};
