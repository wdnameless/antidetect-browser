import * as fs from 'fs';
import * as path from 'path';
import { runEvidenceWrapper, AssertionResult, ArtifactEntry } from './lib/evidence-wrapper';

function parseArgs(): { paths: string[]; jsonPath?: string; rawOutPath?: string; strict: boolean } {
  const args = process.argv.slice(2);
  let paths: string[] = ['evidence', 'config'];
  let jsonPath: string | undefined;
  let rawOutPath: string | undefined;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--paths' && args[i + 1]) {
      paths = args[i + 1].split(',').map((p) => p.trim());
      i++;
    } else if (args[i] === '--json' && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    } else if (args[i] === '--strict') {
      strict = true;
    }
  }

  return { paths, jsonPath, rawOutPath, strict };
}

function findJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const stat = fs.statSync(dir);
  if (stat.isFile() && dir.endsWith('.json')) {
    return [dir];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

async function main(): Promise<void> {
  const { paths, jsonPath, rawOutPath, strict } = parseArgs();
  const command = `check:artifact-hygiene ${jsonPath ? `--json ${jsonPath}` : ''}`.trim();

  await runEvidenceWrapper(
    command,
    jsonPath,
    async () => {
      const assertions: AssertionResult[] = [];
      const allFiles: string[] = [];

      for (const target of paths) {
        allFiles.push(...findJsonFiles(target));
      }

      // If no files found, add a baseline check
      if (allFiles.length === 0) {
        assertions.push({
          id: 'json-hygiene-target-check',
          name: 'No JSON files found in scanned paths or paths do not exist yet',
          passed: !strict,
          details: { paths },
        });
      }

      for (const file of allFiles) {
        const rel = path.relative(process.cwd(), file);
        try {
          const raw = fs.readFileSync(file, 'utf8');
          
          // Check for UTF-8 BOM
          const hasBom = raw.charCodeAt(0) === 0xFEFF;
          if (hasBom) {
            assertions.push({
              id: `json-bom-${rel}`,
              name: `File has unexpected UTF-8 BOM: ${rel}`,
              passed: false,
            });
            continue;
          }

          // Strict JSON parse
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          assertions.push({
            id: `json-valid-${rel}`,
            name: `Valid strict JSON: ${rel}`,
            passed: true,
          });

          // Check for schemaVersion if it is an evidence or config schema
          if (rel.startsWith('evidence') && typeof parsed === 'object' && parsed !== null) {
            const hasSchema = 'schemaVersion' in parsed;
            assertions.push({
              id: `json-schema-${rel}`,
              name: `Evidence artifact declares schemaVersion: ${rel}`,
              passed: hasSchema,
              details: { schemaVersion: parsed.schemaVersion },
            });
          }
        } catch (err: unknown) {
          assertions.push({
            id: `json-parse-error-${rel}`,
            name: `JSON parse error in ${rel}`,
            passed: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const artifacts: ArtifactEntry[] = jsonPath ? [{ path: jsonPath, description: 'JSON artifact hygiene report' }] : [];

      return {
        assertions,
        artifacts,
        extra: { scannedFileCount: allFiles.length },
      };
    },
    { rawOutPath, strict }
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
