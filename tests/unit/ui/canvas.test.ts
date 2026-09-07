import { describe, it, expect } from 'vitest';
import { NODE_PALETTE, FlowCanvas } from '../../../src/renderer/src/pages/FlowCanvas';
import { FlowDocument, FlowNodeSchema } from '../../../src/main/flows/types';
import { validateFlow } from '../../../src/main/flows/validator';

describe('FlowCanvas Component & UI Logic', () => {
  it('should export FlowCanvas component and comprehensive NODE_PALETTE', () => {
    expect(FlowCanvas).toBeDefined();
    expect(NODE_PALETTE.length).toBeGreaterThanOrEqual(8);

    const types = NODE_PALETTE.map(p => p.type);
    expect(types).toContain('navigate');
    expect(types).toContain('click');
    expect(types).toContain('type');
    expect(types).toContain('wait');
    expect(types).toContain('condition');
    expect(types).toContain('loop');
    expect(types).toContain('extract');
    expect(types).toContain('screenshot');
    expect(types).toContain('eval');
    expect(types).toContain('module');
  });

  it('validates default config for all palette nodes conforming to schema', () => {
    for (const item of NODE_PALETTE) {
      expect(item.type).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.category).toMatch(/^(Actions|Logic|Data|Advanced)$/);
      expect(item.defaultConfig).toBeDefined();

      const candidateNode = {
        id: `node-test-${item.type}`,
        type: item.type,
        name: item.label,
        ...item.defaultConfig,
      };

      const parseResult = FlowNodeSchema.safeParse(candidateNode);
      expect(parseResult.success).toBe(true);
    }
  });

  it('detects inline validation errors when a node has invalid or missing configuration', () => {
    const invalidDoc: FlowDocument = {
      version: 1,
      id: 'canvas-test-flow-invalid',
      name: 'Invalid Flow Test',
      entryNodeId: 'node-nav-1',
      variables: [],
      nodes: [
        {
          id: 'node-nav-1',
          type: 'navigate',
          name: 'Invalid Nav',
          // Missing required 'url'
          url: '',
          timeoutMs: 5000,
        },
        {
          id: 'node-click-1',
          type: 'click',
          name: 'Invalid Click',
          // Missing required 'selector'
          selector: '',
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'node-nav-1',
          target: 'node-click-1',
          branch: 'default',
        },
      ],
    };

    const validation = validateFlow(invalidDoc);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(2);

    const navError = validation.errors.find(e => e.nodeId === 'node-nav-1');
    expect(navError).toBeDefined();
    expect(navError?.message).toMatch(/url/i);

    const clickError = validation.errors.find(e => e.nodeId === 'node-click-1');
    expect(clickError).toBeDefined();
    expect(clickError?.message).toMatch(/selector/i);
  });

  it('validates edge connections and detects disconnected/unreachable nodes', () => {
    const disconnectedDoc: FlowDocument = {
      version: 1,
      id: 'flow-disconnected',
      name: 'Disconnected Flow',
      entryNodeId: 'start',
      variables: [],
      nodes: [
        {
          id: 'start',
          type: 'navigate',
          name: 'Start',
          url: 'https://example.com',
        },
        {
          id: 'orphan-1',
          type: 'wait',
          name: 'Orphan Wait',
          waitType: 'time',
          durationMs: 1000,
        },
      ],
      edges: [],
    };

    const result = validateFlow(disconnectedDoc);
    expect(result.valid).toBe(false);
    const orphanErr = result.errors.find(e => e.nodeId === 'orphan-1');
    expect(orphanErr).toBeDefined();
    expect(orphanErr?.code).toBe('UNREACHABLE_NODE');
  });

  it('validates edge editing with condition branching (true/false paths)', () => {
    const branchingDoc: FlowDocument = {
      version: 1,
      id: 'branch-flow',
      name: 'Branching Flow',
      entryNodeId: 'cond-node',
      variables: [],
      nodes: [
        {
          id: 'cond-node',
          type: 'condition',
          name: 'Check User',
          expression: 'vars.isLoggedIn === true',
        },
        {
          id: 'nav-success',
          type: 'navigate',
          name: 'Go to Dashboard',
          url: 'https://example.com/dashboard',
        },
        {
          id: 'nav-login',
          type: 'navigate',
          name: 'Go to Login',
          url: 'https://example.com/login',
        },
      ],
      edges: [
        {
          id: 'e-true',
          source: 'cond-node',
          target: 'nav-success',
          branch: 'true',
        },
        {
          id: 'e-false',
          source: 'cond-node',
          target: 'nav-login',
          branch: 'false',
        },
      ],
    };

    const validation = validateFlow(branchingDoc);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('detects cycle errors on invalid edge configurations', () => {
    const cycleDoc: FlowDocument = {
      version: 1,
      id: 'cycle-flow',
      name: 'Cyclic Flow',
      entryNodeId: 'node-a',
      variables: [],
      nodes: [
        { id: 'node-a', type: 'navigate', name: 'A', url: 'https://a.com' },
        { id: 'node-b', type: 'navigate', name: 'B', url: 'https://b.com' },
      ],
      edges: [
        { id: 'e1', source: 'node-a', target: 'node-b', branch: 'default' },
        { id: 'e2', source: 'node-b', target: 'node-a', branch: 'default' },
      ],
    };

    const validation = validateFlow(cycleDoc);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.code === 'CYCLIC_LOOP_GUARD')).toBe(true);
  });
});
