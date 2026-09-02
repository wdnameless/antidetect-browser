import { describe, it, expect } from 'vitest';
import { FlowDocument } from '../../../src/main/flows/types';
import { validateFlow } from '../../../src/main/flows/validator';

describe('Flow Schema and Validation', () => {
  const baseValidFlow: FlowDocument = {
    version: 1,
    id: 'flow-valid-1',
    name: 'Valid Flow',
    description: 'A test flow',
    entryNodeId: 'node-start',
    variables: [
      { name: 'targetUrl', type: 'string', defaultValue: 'https://example.com' },
      { name: 'counter', type: 'number', defaultValue: 0 },
      { name: 'isEnabled', type: 'boolean', defaultValue: true },
    ],
    nodes: [
      {
        id: 'node-start',
        type: 'navigate',
        name: 'Start Nav',
        config: { url: '{{targetUrl}}', timeoutMs: 5000 },
      },
      {
        id: 'node-eval',
        type: 'eval',
        name: 'Evaluate math',
        config: { code: 'return 42;' },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-start',
        target: 'node-eval',
        branch: 'default',
      },
    ],
  };

  it('validates a correct flow document with 0 errors', () => {
    const res = validateFlow(baseValidFlow);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects dangling edge: source node does not exist', () => {
    const flow: FlowDocument = {
      ...baseValidFlow,
      edges: [
        { id: 'e1', source: 'non-existent-source', target: 'node-eval', branch: 'default' },
      ],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'DANGLING_EDGE_SOURCE' && e.edgeId === 'e1')).toBe(true);
  });

  it('rejects dangling edge: target node does not exist', () => {
    const flow: FlowDocument = {
      ...baseValidFlow,
      edges: [
        { id: 'e1', source: 'node-start', target: 'non-existent-target', branch: 'default' },
      ],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'DANGLING_EDGE_TARGET' && e.edgeId === 'e1')).toBe(true);
  });

  it('rejects unreachable nodes (disconnected islands)', () => {
    const flow: FlowDocument = {
      ...baseValidFlow,
      nodes: [
        ...baseValidFlow.nodes,
        {
          id: 'island-node',
          type: 'wait',
          name: 'Orphan Wait',
          config: { durationMs: 1000 },
        },
      ],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'UNREACHABLE_NODE' && e.nodeId === 'island-node')).toBe(true);
  });

  it('detects edge branch errors on non-branching nodes', () => {
    const flow: FlowDocument = {
      ...baseValidFlow,
      edges: [
        {
          id: 'e-bad-true',
          source: 'node-start',
          target: 'node-eval',
          branch: 'true', // navigate only supports 'default'
        },
      ],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'INVALID_EDGE_BRANCH')).toBe(true);
  });

  it('validates condition branch edges (true and false branches)', () => {
    const conditionFlow: FlowDocument = {
      version: 1,
      id: 'flow-cond-1',
      name: 'Condition Flow',
      entryNodeId: 'c1',
      variables: [],
      nodes: [
        {
          id: 'c1',
          type: 'condition',
          name: 'Check value',
          config: { expression: 'variables.counter > 0' },
        },
        {
          id: 'act-true',
          type: 'eval',
          name: 'True Branch',
          config: { code: 'return "yes";' },
        },
        {
          id: 'act-false',
          type: 'eval',
          name: 'False Branch',
          config: { code: 'return "no";' },
        },
      ],
      edges: [
        { id: 'e-t', source: 'c1', target: 'act-true', branch: 'true' },
        { id: 'e-f', source: 'c1', target: 'act-false', branch: 'false' },
      ],
    };

    const res = validateFlow(conditionFlow);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('detects missing branch edges on condition node', () => {
    const conditionFlow: FlowDocument = {
      version: 1,
      id: 'flow-cond-bad',
      name: 'Condition Flow Bad',
      entryNodeId: 'c1',
      variables: [],
      nodes: [
        {
          id: 'c1',
          type: 'condition',
          name: 'Check value',
          config: { expression: 'true' },
        },
        {
          id: 'act-true',
          type: 'eval',
          name: 'True Branch',
          config: { code: 'return "yes";' },
        },
      ],
      edges: [
        { id: 'e-t', source: 'c1', target: 'act-true', branch: 'true' },
      ],
    };

    const res = validateFlow(conditionFlow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'CONDITION_MISSING_BRANCH')).toBe(true);
  });

  it('detects cyclic loops without loop-guard / loop nodes', () => {
    const cycleFlow: FlowDocument = {
      version: 1,
      id: 'cycle-flow',
      name: 'Cycle Flow',
      entryNodeId: 'n1',
      variables: [],
      nodes: [
        { id: 'n1', type: 'wait', name: 'Wait 1', config: { durationMs: 100 } },
        { id: 'n2', type: 'wait', name: 'Wait 2', config: { durationMs: 200 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', branch: 'default' },
        { id: 'e2', source: 'n2', target: 'n1', branch: 'default' }, // infinite cycle without loop node
      ],
    };

    const res = validateFlow(cycleFlow);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'CYCLIC_LOOP_GUARD')).toBe(true);
  });

  it('allows cyclic back-edges from loop node body to loop node with maxIterations guard', () => {
    const validLoopFlow: FlowDocument = {
      version: 1,
      id: 'valid-loop-flow',
      name: 'Valid Loop',
      entryNodeId: 'loop-1',
      variables: [],
      nodes: [
        {
          id: 'loop-1',
          type: 'loop',
          name: 'My Loop',
          loopType: 'count',
          count: 5,
          maxIterations: 10,
        },
        {
          id: 'body-node',
          type: 'eval',
          name: 'Loop Action',
          config: { code: 'return 1;' },
        },
        {
          id: 'done-node',
          type: 'wait',
          name: 'Done Wait',
          config: { durationMs: 50 },
        },
      ],
      edges: [
        { id: 'e-body', source: 'loop-1', target: 'body-node', branch: 'body' },
        { id: 'e-done', source: 'loop-1', target: 'done-node', branch: 'done' },
        { id: 'e-back', source: 'body-node', target: 'loop-1', branch: 'default' },
      ],
    };

    const res = validateFlow(validLoopFlow);
    if (!res.valid) console.log('VALID LOOP FLOW ERRORS:', res.errors);
    expect(res.valid).toBe(true);
  });
});
