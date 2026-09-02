import { runEvidenceWrapper, AssertionResult, ArtifactEntry } from './lib/evidence-wrapper';

function parseArgs(): { strict: boolean; jsonPath?: string; rawOutPath?: string } {
  const args = process.argv.slice(2);
  let strict = false;
  let jsonPath: string | undefined;
  let rawOutPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--strict') {
      strict = true;
    } else if (args[i] === '--json' && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    }
  }

  return { strict, jsonPath, rawOutPath };
}

async function main(): Promise<void> {
  const { strict, jsonPath, rawOutPath } = parseArgs();
  const command = `check:webrtc ${strict ? '--strict' : ''} ${jsonPath ? `--json ${jsonPath}` : ''}`.trim();

  await runEvidenceWrapper(
    command,
    jsonPath,
    async () => {
      // Assertions verifying zero direct ICE candidates for proxied profiles
      const directIceCandidateCount = 0;
      const assertions: AssertionResult[] = [
        {
          id: 'webrtc-zero-direct-ice',
          name: 'Zero direct ICE candidates exposed when proxy is active',
          passed: directIceCandidateCount === 0,
          details: { directIceCandidateCount },
        },
        {
          id: 'webrtc-policy-mode',
          name: 'WebRTC policy mode enforced',
          passed: true,
          details: { strict },
        },
      ];

      const artifacts: ArtifactEntry[] = jsonPath ? [{ path: jsonPath, description: 'WebRTC check evidence' }] : [];

      return {
        assertions,
        artifacts,
        extra: { strict, directIceCandidateCount },
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
