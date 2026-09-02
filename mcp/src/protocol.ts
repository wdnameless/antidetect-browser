export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
  FORBIDDEN: { code: -32003, message: 'Forbidden: Insufficient scope or permissions' },
  PROHIBITED: { code: -32004, message: 'Prohibited: Operation violates safety policy' },
  NONCE_REPLAY: { code: -32005, message: 'Invalid or replayed nonce' },
  AUTH_EXPIRED: { code: -32006, message: 'Authentication expired or invalid' },
} as const;

export function createErrorResponse(
  id: string | number | null,
  errorSpec: { code: number; message: string },
  detail?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: errorSpec.code,
      message: errorSpec.message,
      ...(detail !== undefined ? { data: detail } : {}),
    },
  };
}

export function createSuccessResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: result ?? {},
  };
}

export function parseJsonRpcMessage(message: string): { request?: JsonRpcRequest; error?: JsonRpcResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch (err) {
    return {
      error: createErrorResponse(null, RPC_ERRORS.PARSE_ERROR, String(err)),
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      error: createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'Message must be a JSON object'),
    };
  }

  const req = parsed as Record<string, unknown>;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return {
      error: createErrorResponse((req.id as string | number | null) ?? null, RPC_ERRORS.INVALID_REQUEST, 'Must specify jsonrpc: "2.0" and method'),
    };
  }

  return {
    request: parsed as JsonRpcRequest,
  };
}
