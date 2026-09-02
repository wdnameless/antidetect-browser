import { z } from 'zod';

export const FlowNodeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const NavigateNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('navigate'),
  url: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

export const ClickNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('click'),
  selector: z.string().min(1),
  waitForSelector: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const TypeNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('type'),
  selector: z.string().min(1),
  text: z.string(),
  clearFirst: z.boolean().optional(),
  delayMs: z.number().int().nonnegative().optional(),
});

export const WaitNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('wait'),
  waitType: z.enum(['time', 'selector', 'navigation']).default('time'),
  durationMs: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const ConditionNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('condition'),
  // expression returning boolean or variable comparison
  expression: z.string().min(1),
});

export const LoopNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('loop'),
  loopType: z.enum(['count', 'items', 'while']),
  count: z.number().int().positive().optional(),
  itemsVariable: z.string().optional(),
  itemVariable: z.string().optional(),
  condition: z.string().optional(),
  maxIterations: z.number().int().positive().default(100),
});

export const ExtractNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('extract'),
  selector: z.string().min(1),
  attribute: z.string().optional(), // empty or undefined means textContent / innerText
  variable: z.string().min(1),
  multiple: z.boolean().optional(),
});

export const ScreenshotNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('screenshot'),
  name: z.string().optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
  variable: z.string().optional(), // store data URI / path in variable
});

export const EvalNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('eval'),
  code: z.string().min(1),
  variable: z.string().optional(), // assign result to variable
});

export const ModuleNodeSchema = FlowNodeBaseSchema.extend({
  type: z.literal('module'),
  moduleId: z.string().min(1), // script id or module name
  args: z.record(z.unknown()).optional(),
  variable: z.string().optional(),
});

export const FlowNodeSchema = z.discriminatedUnion('type', [
  NavigateNodeSchema,
  ClickNodeSchema,
  TypeNodeSchema,
  WaitNodeSchema,
  ConditionNodeSchema,
  LoopNodeSchema,
  ExtractNodeSchema,
  ScreenshotNodeSchema,
  EvalNodeSchema,
  ModuleNodeSchema,
]);

export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  // Condition branch: 'true' | 'false' | 'body' (loop body) | 'done' (loop exit) | 'default'
  branch: z.enum(['true', 'false', 'body', 'done', 'default']).default('default'),
});

export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowVariableSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid variable name identifier'),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
});

export type FlowVariable = z.infer<typeof FlowVariableSchema>;

export const FlowDocumentSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  entryNodeId: z.string().min(1),
  variables: z.array(FlowVariableSchema).default([]),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(FlowEdgeSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.number().int().optional(),
  updated_at: z.number().int().optional(),
});

export type FlowDocument = z.infer<typeof FlowDocumentSchema>;

export interface FlowValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
