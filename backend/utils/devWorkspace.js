import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A development-only identifier lets startup recognize this checkout without
// publishing its filesystem path or mistaking another app for this project.
export const DEV_WORKSPACE_HEADER = 'x-shoe-store-workspace';
export const devWorkspaceId = createHash('sha256')
  .update(path.resolve(fileURLToPath(new URL('../../', import.meta.url))))
  .digest('hex').slice(0, 24);
