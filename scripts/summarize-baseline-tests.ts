import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJson } from './lib/jcs';

interface VitestAssertionResult {
  title: string;
  status: string;
  ancestorTitles: string[];
}

interface VitestTestResult {
  name: string;
  status: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestReport {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  success: boolean;
  startTime: number;
  testResults: VitestTestResult[];
}

function normalizeReport(rawPath: string, normalizedPath: string, testType: string) {
  if (fs.existsSync(rawPath)) {
    const vitestData = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as VitestReport;
    const summary = {
      schemaVersion: '1',
      testType,
      numTotalTestSuites: vitestData.numTotalTestSuites,
      numPassedTestSuites: vitestData.numPassedTestSuites,
      numFailedTestSuites: vitestData.numFailedTestSuites,
      numTotalTests: vitestData.numTotalTests,
      numPassedTests: vitestData.numPassedTests,
      numFailedTests: vitestData.numFailedTests,
      success: vitestData.success,
      startTime: vitestData.startTime,
      testResults: (vitestData.testResults || []).map((r) => ({
        name: path.relative(process.cwd(), r.name).replace(/\\/g, '/'),
        status: r.status,
        assertionResults: (r.assertionResults || []).map((a) => ({
          title: a.title,
          status: a.status,
          ancestorTitles: a.ancestorTitles,
        })),
      })),
    };

    fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
    fs.writeFileSync(normalizedPath, canonicalizeJson(summary), 'utf8');
    console.log('Successfully written normalized summary to', normalizedPath);
  }
}

normalizeReport(
  path.resolve(process.cwd(), 'evidence/raw/baseline-chromium.vitest.json'),
  path.resolve(process.cwd(), 'evidence/normalized/baseline-chromium.summary.jcs.json'),
  'unit-baseline-chromium'
);

normalizeReport(
  path.resolve(process.cwd(), 'evidence/raw/baseline-fingerprint.vitest.json'),
  path.resolve(process.cwd(), 'evidence/normalized/baseline-fingerprint.summary.jcs.json'),
  'unit-baseline-fingerprint'
);

normalizeReport(
  path.resolve(process.cwd(), 'evidence/raw/baseline-tamper.vitest.json'),
  path.resolve(process.cwd(), 'evidence/normalized/baseline-tamper.summary.jcs.json'),
  'unit-baseline-tamper'
);

normalizeReport(
  path.resolve(process.cwd(), 'evidence/raw/baseline-publish-acceptance.vitest.json'),
  path.resolve(process.cwd(), 'evidence/normalized/baseline-publish-acceptance.summary.jcs.json'),
  'unit-baseline-publish-acceptance'
);
