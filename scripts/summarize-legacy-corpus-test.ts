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

const rawVitestPath = path.resolve(process.cwd(), 'evidence/raw/legacy-corpus.vitest.json');
const normalizedSummaryPath = path.resolve(process.cwd(), 'evidence/normalized/legacy-corpus.summary.jcs.json');

if (fs.existsSync(rawVitestPath)) {
  const vitestData = JSON.parse(fs.readFileSync(rawVitestPath, 'utf8')) as VitestReport;
  const summary = {
    schemaVersion: '1',
    testType: 'unit-legacy-corpus',
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

  fs.mkdirSync(path.dirname(normalizedSummaryPath), { recursive: true });
  fs.writeFileSync(normalizedSummaryPath, canonicalizeJson(summary), 'utf8');
  console.log('Successfully written normalized summary to', normalizedSummaryPath);
}
