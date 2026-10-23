import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureMongoDns } from './mongoDns.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(directory, '../.env'),
  path.resolve(directory, '../../.env'),
  path.resolve(directory, '../../env'),
];
const envPath = candidates.find((candidate) => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath, quiet: true });

// Optional process-local SRV/TXT DNS override. Invalid explicit configuration
// fails with a fixed message; configured values and underlying errors stay private.
configureMongoDns();
