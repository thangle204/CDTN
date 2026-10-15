import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(directory, '../.env'),
  path.resolve(directory, '../../.env'),
  path.resolve(directory, '../../env'),
];
const envPath = candidates.find((candidate) => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath, quiet: true });
