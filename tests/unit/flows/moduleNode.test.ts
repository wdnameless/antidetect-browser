import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFlowToScript } from '../../../src/main/flows/compiler';
import { validateFlow } from '../../../src/main/flows/validator';
import { FlowDocument } from '../../../src/main/flows/types';
import * as scriptEngine from '../../../src/main/scripts/scriptEngine';

describe('Flow Module Node Execution (B4 defect)', () => {
  it('compiles a module node using app.callModule and assigns variable without fabricated success object', () => {
    const flow: FlowDocument = {
      id: 'test-flow-1',
      name: 'Test Flow',
      version: '1.0.0',
      entryNodeId: 'node-mod',
      nodes: [
        {
          id: 'node-mod',
          type: 'module',
          moduleId: 'module-123',
          args: { foo: 'bar', num: 42 },
          variable: 'modOutput',
        },
      ],
      edges: [],
      variables: [],
    };

    const compiled = compileFlowToScript(flow);
    // Must NOT contain the old fabricated success object
    expect(compiled).not.toContain('const __moduleResult = { success: true');
    expect(compiled).not.toContain('{ success: true, moduleId:');

    // Must invoke app.callModule
    expect(compiled).toContain('const __moduleId = "module-123";');
    expect(compiled).toContain('const __moduleResult = await app.callModule(__moduleId, __args);');
    expect(compiled).toContain('__vars["modOutput"] = __moduleResult;');
  });

  it('compiles a module node without variable binding when variable is omitted', () => {
    const flow: FlowDocument = {
      id: 'test-flow-2',
      name: 'Test Flow 2',
      version: '1.0.0',
      entryNodeId: 'node-mod',
      nodes: [
        {
          id: 'node-mod',
          type: 'module',
          moduleId: 'module-abc',
        },
      ],
      edges: [],
      variables: [],
    };

    const compiled = compileFlowToScript(flow);
    expect(compiled).toContain('const __moduleId = "module-abc";');
    expect(compiled).toContain('const __moduleResult = await app.callModule(__moduleId, __args);');
    expect(compiled).not.toContain('__vars[');
  });

  it('fails flow validation at save-time if module node references a non-existent script id', () => {
    const getScriptSpy = vi.spyOn(scriptEngine, 'getScript').mockReturnValue(undefined);

    const flow: FlowDocument = {
      id: 'test-flow-3',
      name: 'Test Flow 3',
      version: '1.0.0',
      entryNodeId: 'node-mod',
      nodes: [
        {
          id: 'node-mod',
          type: 'module',
          moduleId: 'missing-script-xyz',
        },
      ],
      edges: [],
      variables: [],
    };

    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MODULE_NOT_FOUND',
          message: expect.stringContaining('missing-script-xyz'),
          nodeId: 'node-mod',
        }),
      ])
    );

    getScriptSpy.mockRestore();
  });

  it('passes flow validation if module node references an existing script', () => {
    const getScriptSpy = vi.spyOn(scriptEngine, 'getScript').mockReturnValue({
      id: 'valid-script-123',
      name: 'Valid Script',
      code: 'return 1;',
      created_at: 0,
      updated_at: 0,
      last_run_at: null,
      last_status: null,
    });

    const flow: FlowDocument = {
      id: 'test-flow-4',
      name: 'Test Flow 4',
      version: '1.0.0',
      entryNodeId: 'node-mod',
      nodes: [
        {
          id: 'node-mod',
          type: 'module',
          moduleId: 'valid-script-123',
        },
      ],
      edges: [],
      variables: [],
    };

    const result = validateFlow(flow);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    getScriptSpy.mockRestore();
  });
});
