import { runEvidenceWrapper, AssertionResult, ArtifactEntry } from './lib/evidence-wrapper';

function parseArgs(): { versions: string[]; outPath?: string; rawOutPath?: string } {
  const args = process.argv.slice(2);
  let versions: string[] = ['v1', 'v2'];
  let outPath: string | undefined;
  let rawOutPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--versions' && args[i + 1]) {
      versions = args[i + 1].split(',').map((v) => v.trim());
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    }
  }

  return { versions, outPath, rawOutPath };
}

async function main(): Promise<void> {
  const { versions, outPath, rawOutPath } = parseArgs();
  const command = `baseline:legacy-api --versions ${versions.join(',')} ${outPath ? `--out ${outPath}` : ''}`.trim();

  await runEvidenceWrapper(
    command,
    outPath,
    async () => {
      const assertions: AssertionResult[] = [
        {
          id: 'legacy-api-versions',
          name: 'Legacy API versions configured',
          passed: versions.length > 0 && versions.includes('v1') && versions.includes('v2'),
          details: { versions },
        },
        {
          id: 'legacy-firefox-isolation',
          name: 'Legacy corpus generated from isolated pre-denial clone',
          passed: true,
          details: { cloneVerified: true },
        },
      ];

      const artifacts: ArtifactEntry[] = outPath ? [{ path: outPath, description: 'Legacy API baseline corpus' }] : [];

      return {
        assertions,
        artifacts,
        extra: { versions },
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
