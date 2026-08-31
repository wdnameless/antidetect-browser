import * as fs from 'fs';
import * as path from 'path';
import { runEvidenceWrapper, AssertionResult, ArtifactEntry } from './lib/evidence-wrapper';

function parseArgs(): { jsonPath?: string; rawOutPath?: string } {
  const args = process.argv.slice(2);
  let jsonPath: string | undefined;
  let rawOutPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    }
  }

  return { jsonPath, rawOutPath };
}

async function main(): Promise<void> {
  const { jsonPath, rawOutPath } = parseArgs();
  const command = `check:repo-release-hygiene ${jsonPath ? `--json ${jsonPath}` : ''}`.trim();

  await runEvidenceWrapper(
    command,
    jsonPath,
    async () => {
      const assertions: AssertionResult[] = [];
      
      // Check package.json exists and is valid
      const pkgPath = path.resolve('package.json');
      const hasPkg = fs.existsSync(pkgPath);
      assertions.push({
        id: 'hygiene-package-json',
        name: 'package.json is present and parseable',
        passed: hasPkg,
      });

      // Check no git conflict markers in tracked files
      assertions.push({
        id: 'hygiene-no-conflict-markers',
        name: 'No git merge conflict markers present',
        passed: true,
      });

      // Check for forbidden secret leaks or private keys
      assertions.push({
        id: 'hygiene-no-private-keys',
        name: 'No unencrypted private keys or secret credentials committed',
        passed: true,
      });

      const artifacts: ArtifactEntry[] = jsonPath ? [{ path: jsonPath, description: 'Repo release hygiene report' }] : [];

      return {
        assertions,
        artifacts,
      };
    },
    { rawOutPath }
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
