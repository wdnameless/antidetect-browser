import { describe, it, expect } from 'vitest';
import { compileFlowToScript } from '../../../src/main/flows/compiler';
import { FlowDocument } from '../../../src/main/flows/types';

describe('Flow Compiler - Determinism & Per-Node Codegen', () => {
  it('produces byte-identical output for identical input', () => {
    const flow: FlowDocument = {
      schemaVersion: '1.0.0',
      id: 'flow-det',
      name: 'Deterministic Flow',
      entryNodeId: 'nav-1',
      variables: [
        { name: 'b', type: 'string', defaultValue: 'test' },
        { name: 'a', type: 'number', defaultValue: 123 },
      ],
      nodes: [
        {
          id: 'wait-1',
          type: 'wait',
          name: 'Wait',
          timeoutMs: 1000,
        },
        {
          id: 'nav-1',
          type: 'navigate',
          name: 'Go Home',
          url: 'https://example.com',
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'nav-1',
          target: 'wait-1',
          branch: 'default',
        },
      ],
    };

    const code1 = compileFlowToScript(flow);
    const code2 = compileFlowToScript(flow);
    expect(code1).toBe(code2);
    expect(Buffer.from(code1).equals(Buffer.from(code2))).toBe(true);
  });

  it('generates expected code for navigate, click, type, wait', () => {
    const flow: FlowDocument = {
      schemaVersion: '1.0.0',
      id: 'browser-flow',
      name: 'Browser Flow',
      entryNodeId: 'n-nav',
      variables: [],
      nodes: [
        { id: 'n-nav', type: 'navigate', name: 'Nav', url: 'https://example.com' },
        { id: 'n-click', type: 'click', name: 'Click', selector: '#btn' },
        { id: 'n-type', type: 'type', name: 'Type', selector: '#input', text: 'hello' },
        { id: 'n-wait', type: 'wait', name: 'Wait', timeoutMs: 500 },
      ],
      edges: [
        { id: 'e1', source: 'n-nav', target: 'n-click', branch: 'default' },
        { id: 'e2', source: 'n-click', target: 'n-type', branch: 'default' },
        { id: 'e3', source: 'n-type', target: 'n-wait', branch: 'default' },
      ],
    };

    const code = compileFlowToScript(flow);
    expect(code).toContain('__logSpanStart("n-nav", "navigate")');
    expect(code).toContain('__logSpanStart("n-click", "click")');
    expect(code).toContain('__logSpanStart("n-type", "type")');
    expect(code).toContain('__logSpanStart("n-wait", "wait")');
    expect(code).toContain('https://example.com');
    expect(code).toContain('#btn');
    expect(code).toContain('#input');
    expect(code).toMatchSnapshot();
  });

  it('generates expected code for condition, loop, extract, screenshot, eval, module', () => {
    const flow: FlowDocument = {
      schemaVersion: '1.0.0',
      id: 'complex-flow',
      name: 'Complex Flow',
      entryNodeId: 'n-cond',
      variables: [{ name: 'count', type: 'number', defaultValue: 0 }],
      nodes: [
        { id: 'n-cond', type: 'condition', name: 'Check', expression: 'vars.count > 0' },
        { id: 'n-loop', type: 'loop', name: 'Loop', loopType: 'count', count: 3, maxIterations: 5 },
        { id: 'n-extract', type: 'extract', name: 'Extract', selector: 'h1', variable: 'title' },
        { id: 'n-shot', type: 'screenshot', name: 'Shot', fullPage: true },
        { id: 'n-eval', type: 'eval', name: 'Eval', code: 'vars.count += 1;' },
        { id: 'n-mod', type: 'module', name: 'Mod', moduleId: 'auth-mod' },
      ],
      edges: [
        { id: 'e1', source: 'n-cond', target: 'n-loop', branch: 'true' },
        { id: 'e2', source: 'n-cond', target: 'n-extract', branch: 'false' },
        { id: 'e3', source: 'n-loop', target: 'n-shot', branch: 'body' },
        { id: 'e4', source: 'n-loop', target: 'n-eval', branch: 'done' },
        { id: 'e5', source: 'n-extract', target: 'n-mod', branch: 'default' },
      ],
    };

    const code = compileFlowToScript(flow);
    expect(code).toContain('__logSpanStart("n-cond", "condition")');
    expect(code).toContain('__logSpanStart("n-loop", "loop")');
    expect(code).toContain('__logSpanStart("n-extract", "extract")');
    expect(code).toContain('__logSpanStart("n-shot", "screenshot")');
    expect(code).toContain('__logSpanStart("n-eval", "eval")');
    expect(code).toContain('__logSpanStart("n-mod", "module")');
    expect(code).toMatchSnapshot();
  });
});
