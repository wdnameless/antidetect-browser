// Types for the tool manifest. Dependency-free so the manifest can be imported from the
// main process without dragging the MCP runtime (and its @antidetect/sdk dependency) in.

// Types for the tool manifest, kept dependency-free for the same reason as the manifest.

export interface ToolManifest {

  name: string;
  description: string;
  tier: 'default' | 'gated';
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}