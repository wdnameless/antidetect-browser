import { FlowDocument, FlowValidationError, FlowNode, FlowEdge } from './types';

/**
 * Validates a FlowDocument against structural, topological, and semantic rules:
 * - 1. Entry node must exist
 * - 2. Dangling edges (source or target node does not exist)
 * - 3. Unreachable nodes (nodes that cannot be reached from entryNodeId)
 * - 4. Edge type / branch validation:
 *      - Condition nodes MUST have outgoing edges specifying branch 'true' and/or 'false' (cannot have 'default' or invalid branch).
 *      - Non-condition / non-loop nodes must use branch 'default'.
 *      - Loop nodes can have 'body' and 'done' branches.
 * - 5. Loop guard validation: loop nodes must specify guard bounds (count > 0 or maxIterations > 0 or safe condition)
 *      to avoid unbounded infinite loops, and body branch must not create an unguarded cycle.
 * - 6. Duplicate node or edge IDs.
 */
export function validateFlow(flow: FlowDocument): { valid: boolean; errors: FlowValidationError[] } {
  const errors: FlowValidationError[] = [];

  // Check duplicate node IDs
  const nodeMap = new Map<string, FlowNode>();
  for (const node of flow.nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `Duplicate node ID: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodeMap.set(node.id, node);
  }

  // Check duplicate edge IDs
  const edgeSet = new Set<string>();
  for (const edge of flow.edges) {
    if (edgeSet.has(edge.id)) {
      errors.push({
        code: 'DUPLICATE_EDGE_ID',
        message: `Duplicate edge ID: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    edgeSet.add(edge.id);
  }

  // 1. Entry node exists
  if (!nodeMap.has(flow.entryNodeId)) {
    errors.push({
      code: 'MISSING_ENTRY_NODE',
      message: `Entry node with ID '${flow.entryNodeId}' does not exist`,
      nodeId: flow.entryNodeId,
    });
  }

  // 2. Dangling edges
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    let dangling = false;
    if (!nodeMap.has(edge.source)) {
      errors.push({
        code: 'DANGLING_EDGE_SOURCE',
        message: `Edge '${edge.id}' has nonexistent source node '${edge.source}'`,
        edgeId: edge.id,
      });
      dangling = true;
    }
    if (!nodeMap.has(edge.target)) {
      errors.push({
        code: 'DANGLING_EDGE_TARGET',
        message: `Edge '${edge.id}' has nonexistent target node '${edge.target}'`,
        edgeId: edge.id,
      });
      dangling = true;
    }

    if (!dangling) {
      const list = outgoingMap.get(edge.source) || [];
      list.push(edge);
      outgoingMap.set(edge.source, list);
    }
  }

  // 4. Edge branch type errors per node type
  for (const node of flow.nodes) {
    const outgoing = outgoingMap.get(node.id) || [];
    if (node.type === 'condition') {
      for (const e of outgoing) {
        if (e.branch !== 'true' && e.branch !== 'false') {
          errors.push({
            code: 'INVALID_EDGE_BRANCH',
            message: `Condition node '${node.id}' can only have 'true' or 'false' outgoing branches, got '${e.branch}'`,
            nodeId: node.id,
            edgeId: e.id,
          });
        }
      }
      const trueBranches = outgoing.filter((e) => e.branch === 'true');
      const falseBranches = outgoing.filter((e) => e.branch === 'false');
      if (trueBranches.length > 1) {
        errors.push({
          code: 'MULTIPLE_TRUE_BRANCHES',
          message: `Condition node '${node.id}' has more than one 'true' branch`,
          nodeId: node.id,
        });
      }
      if (falseBranches.length > 1) {
        errors.push({
          code: 'MULTIPLE_FALSE_BRANCHES',
          message: `Condition node '${node.id}' has more than one 'false' branch`,
          nodeId: node.id,
        });
      }
      if (trueBranches.length === 0 || falseBranches.length === 0) {
        errors.push({
          code: 'CONDITION_MISSING_BRANCH',
          message: `Condition node '${node.id}' must have both 'true' and 'false' branch edges`,
          nodeId: node.id,
        });
      }
    } else if (node.type === 'loop') {
      for (const e of outgoing) {
        if (e.branch !== 'body' && e.branch !== 'done') {
          errors.push({
            code: 'INVALID_EDGE_BRANCH',
            message: `Loop node '${node.id}' can only have 'body' or 'done' outgoing branches, got '${e.branch}'`,
            nodeId: node.id,
            edgeId: e.id,
          });
        }
      }
      const bodyBranches = outgoing.filter((e) => e.branch === 'body');
      const doneBranches = outgoing.filter((e) => e.branch === 'done');
      if (bodyBranches.length > 1) {
        errors.push({
          code: 'MULTIPLE_BODY_BRANCHES',
          message: `Loop node '${node.id}' has more than one 'body' branch`,
          nodeId: node.id,
        });
      }
      if (doneBranches.length > 1) {
        errors.push({
          code: 'MULTIPLE_DONE_BRANCHES',
          message: `Loop node '${node.id}' has more than one 'done' branch`,
          nodeId: node.id,
        });
      }
    } else {
      for (const e of outgoing) {
        if (e.branch !== 'default') {
          errors.push({
            code: 'INVALID_EDGE_BRANCH',
            message: `Node '${node.id}' of type '${node.type}' only supports 'default' branch, got '${e.branch}'`,
            nodeId: node.id,
            edgeId: e.id,
          });
        }
      }
      if (outgoing.length > 1) {
        errors.push({
          code: 'MULTIPLE_DEFAULT_EDGES',
          message: `Node '${node.id}' has multiple default outgoing edges`,
          nodeId: node.id,
        });
      }
    }
  }

  // 5. Loop guard validation
  for (const node of flow.nodes) {
    if (node.type === 'loop') {
      if (node.loopType === 'count' && (!node.count || node.count <= 0)) {
        errors.push({
          code: 'INVALID_LOOP_GUARD',
          message: `Count loop node '${node.id}' must specify count > 0`,
          nodeId: node.id,
        });
      }
      if (node.loopType === 'items' && !node.itemsVariable) {
        errors.push({
          code: 'INVALID_LOOP_GUARD',
          message: `Items loop node '${node.id}' must specify itemsVariable`,
          nodeId: node.id,
        });
      }
      if (node.loopType === 'while' && !node.condition) {
        errors.push({
          code: 'INVALID_LOOP_GUARD',
          message: `While loop node '${node.id}' must specify condition expression`,
          nodeId: node.id,
        });
      }
      if (!node.maxIterations || node.maxIterations <= 0) {
        errors.push({
          code: 'INVALID_LOOP_GUARD',
          message: `Loop node '${node.id}' must have maxIterations > 0 to guard against infinite cycles`,
          nodeId: node.id,
        });
      }
    }
  }

  // 3. Reachability check from entryNodeId (BFS/DFS)
  if (nodeMap.has(flow.entryNodeId)) {
    const visited = new Set<string>();
    const queue = [flow.entryNodeId];
    visited.add(flow.entryNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const edges = outgoingMap.get(current) || [];
      for (const e of edges) {
        if (!visited.has(e.target) && nodeMap.has(e.target)) {
          visited.add(e.target);
          queue.push(e.target);
        }
      }
    }

    for (const node of flow.nodes) {
      if (!visited.has(node.id)) {
        errors.push({
          code: 'UNREACHABLE_NODE',
          message: `Node '${node.id}' is unreachable from entry node '${flow.entryNodeId}'`,
          nodeId: node.id,
        });
      }
    }
  }

  // 6. Cyclic loop detection without loop guard
  const visitedCycle = new Set<string>();
  const recursionStack = new Set<string>();

  function checkCycle(nodeId: string): boolean {
    const currentNode = nodeMap.get(nodeId);
    if (currentNode?.type === 'loop') {
      return false;
    }

    visitedCycle.add(nodeId);
    recursionStack.add(nodeId);

    const out = outgoingMap.get(nodeId) || [];
    for (const edge of out) {
      const targetNode = nodeMap.get(edge.target);
      if (!targetNode) continue;

      // If edge targets a loop node, loop node guards its iteration limit
      if (targetNode.type === 'loop') {
        continue;
      }
      if (!visitedCycle.has(edge.target)) {
        if (checkCycle(edge.target)) return true;
      } else if (recursionStack.has(edge.target)) {
        errors.push({
          code: 'CYCLIC_LOOP_GUARD',
          message: `Illegal cyclic loop detected at node '${nodeId}' -> '${edge.target}' without a loop guard node`,
          nodeId,
          edgeId: edge.id,
        });
        return true;
      }
    }
    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of flow.nodes) {
    if (!visitedCycle.has(node.id)) {
      checkCycle(node.id);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
