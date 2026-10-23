// Return only fixed text and allowlisted codes. Driver messages and topology
// addresses can contain connection strings, credentials and private hostnames.
const dnsCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'EREFUSED', 'EFORMERR']);
const timeoutCodes = new Set(['ETIMEOUT', 'ETIMEDOUT']);
const tcpCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']);
const tlsCodes = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'CERT_REVOKED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_UNSUPPORTED_PROTOCOL',
]);

const descriptions = {
  authentication: [
    'Xác thực MongoDB thất bại.',
    'Kiểm tra tài khoản database, mật khẩu đã mã hóa URI và authSource trong cấu hình.',
  ],
  tls: [
    'Kết nối TLS đến MongoDB thất bại.',
    'Kiểm tra chứng chỉ, CA tin cậy, ngày giờ máy và phần mềm kiểm tra TLS trên mạng.',
  ],
  tls_handshake: [
    'Kết nối MongoDB bị ngắt trước khi hoàn tất bắt tay TLS, trước bước xác thực tài khoản.',
    'Kiểm tra trạng thái cluster, kết nối mạng, VPN, firewall và phần mềm kiểm tra TLS; chưa thể kết luận sai mật khẩu hoặc thiếu quyền IP.',
  ],
  dns: [
    'Không tra được bản ghi DNS của MongoDB.',
    'Kiểm tra địa chỉ cluster và DNS đang dùng; với mongodb+srv cần tra được cả SRV và TXT.',
  ],
  configuration: [
    'Cấu hình kết nối MongoDB không hợp lệ.',
    'Kiểm tra định dạng MONGO_URI và các tùy chọn kết nối trong backend/.env.',
  ],
  tcp: [
    'Không mở được kết nối mạng đến MongoDB.',
    'Kiểm tra dịch vụ MongoDB, firewall, VPN và Network Access của Atlas nếu đang dùng Atlas.',
  ],
  timeout: [
    'Kết nối MongoDB hết thời gian chờ; chưa xác định được nguyên nhân.',
    'Kiểm tra mạng, firewall và trạng thái cluster; timeout không đủ để kết luận sai mật khẩu hoặc thiếu quyền IP.',
  ],
  unknown: [
    'Không kết nối được MongoDB; chưa xác định được nguyên nhân.',
    'Kiểm tra cấu hình, mạng và trạng thái dịch vụ MongoDB.',
  ],
};

const read = (value, key) => {
  try { return value[key]; } catch { return undefined; }
};

// Mongoose wraps driver errors in cause/reason; server descriptions live in a
// Map whose keys are private addresses. Read values only and bound traversal.
const errorNodes = (error) => {
  const nodes = [];
  const queue = [error];
  const seen = new Set();
  const enqueue = value => {
    if (queue.length < 128) queue.push(value);
  };
  while (queue.length && nodes.length < 128) {
    const node = queue.shift();
    if (!node || (typeof node !== 'object' && typeof node !== 'function') || seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
    for (const key of ['cause', 'reason', 'error']) enqueue(read(node, key));
    const errors = read(node, 'errors');
    if (Array.isArray(errors)) for (const child of errors.slice(0, 128)) enqueue(child);
    const servers = read(node, 'servers');
    if (servers instanceof Map) {
      let count = 0;
      for (const child of servers.values()) {
        enqueue(child);
        if (++count >= 128) break;
      }
    }
  }
  return nodes;
};

const classifyNode = (node) => {
  const code = read(node, 'code');
  const name = read(node, 'name');
  const rawMessage = read(node, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage.slice(0, 4096) : '';
  const syscall = read(node, 'syscall');
  const dnsQuery = (typeof syscall === 'string' && /^(?:query\w*|getaddrinfo)$/i.test(syscall))
    || /\b(?:querySrv|queryTxt|getaddrinfo)\b/i.test(message);
  if (code === 18 || code === 'AuthenticationFailed' || /\b(?:bad auth|authentication failed)\b/i.test(message)) {
    return { kind: 'authentication', code: '18' };
  }
  if (tlsCodes.has(code)) return { kind: 'tls', code };
  if (code === 'ECONNRESET' && /\bbefore secure TLS connection was established\b/i.test(message)) {
    return { kind: 'tls_handshake', code: 'ECONNRESET_BEFORE_TLS' };
  }
  if (dnsCodes.has(code) || (dnsQuery && (timeoutCodes.has(code) || tcpCodes.has(code)))) {
    return { kind: 'dns', code };
  }
  if (['MongoParseError', 'MongoInvalidArgumentError', 'MongoMissingCredentialsError'].includes(name)) {
    return { kind: 'configuration', code: 'INVALID_CONFIGURATION' };
  }
  if (tcpCodes.has(code)) return { kind: 'tcp', code };
  if (timeoutCodes.has(code)) return { kind: 'timeout', code };
  if (name === 'MongoNetworkTimeoutError') return { kind: 'timeout', code: 'NETWORK_TIMEOUT' };
  if (name === 'MongoOperationTimeoutError') return { kind: 'timeout', code: 'OPERATION_TIMEOUT' };
  if (['MongoServerSelectionError', 'MongooseServerSelectionError'].includes(name)) {
    return { kind: 'timeout', code: 'SERVER_SELECTION_TIMEOUT' };
  }
  return null;
};

export const describeMongoConnectionError = (error) => {
  const matches = errorNodes(error).map(classifyNode).filter(Boolean);
  // Concrete nested causes take precedence over a generic selection timeout or
  // Mongoose's stock Atlas message suggesting that an IP may not be allowed.
  const priority = ['authentication', 'tls', 'tls_handshake', 'dns', 'configuration', 'tcp', 'timeout'];
  let result = null;
  for (const kind of priority) {
    result = matches.find(match => match.kind === kind);
    if (result) break;
  }
  result ||= { kind: 'unknown', code: 'UNKNOWN' };
  const [message, advice] = descriptions[result.kind];
  return { ...result, message, advice };
};

export const formatMongoConnectionError = (error) => {
  const { kind, code, message, advice } = describeMongoConnectionError(error);
  return '[MongoDB: ' + kind + ' / ' + code + '] ' + message + ' ' + advice;
};
