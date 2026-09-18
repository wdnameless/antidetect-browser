// Isolated sandbox data dir for unit tests — never touches real user data.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-test-'));
process.env.ANTIDETECT_DATA_DIR = sandbox;

// The SETTINGS directory needs isolating too, and for the same reason. Several tests exercise
// the data-folder machinery, which persists the choice through `setDataDir` → `writeSettings`;
// with only the data dir redirected, that wrote `<temp>/antidetect-test-XXXX` as the operator's
// chosen folder in the real `~/.antidetect/settings.json`. Harmless to the app (which reads its
// own settings directory) but it leaves debris in the user's profile, and on a build that does
// read `~/.antidetect` it would move the data directory out from under them.
process.env.ANTIDETECT_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-test-settings-'));
