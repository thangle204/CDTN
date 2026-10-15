export const rateLimit = ({ limit, windowMs }) => {
  const attempts = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(key);
    }
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const entry = attempts.get(key) || { count: 0, expiresAt: now + windowMs };
    if (entry.count >= limit) {
      res.set('Retry-After', String(Math.ceil((entry.expiresAt - now) / 1000)));
      return res.status(429).json({ message: 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau' });
    }
    entry.count += 1;
    attempts.set(key, entry);
    next();
  };
};
