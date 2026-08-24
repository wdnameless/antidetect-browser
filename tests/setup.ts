// Isolated sandbox data dir for unit tests — never touches real user data.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-test-'));
process.env.ANTIDETECT_DATA_DIR = sandbox;
