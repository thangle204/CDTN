import jwt from 'jsonwebtoken';

const generateToken = (id, { authVersion = 0, accountType = 'customer' } = {}) =>
  jwt.sign({ id, authVersion, accountType }, process.env.JWT_SECRET, { expiresIn: '30d' });

export default generateToken;
