import { describe, it, expect } from 'vitest';
import profilesRouter from '../../../src/main/api/routes/profiles';

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

describe('Profile Route Additive OS/Chip Selection Handler', () => {
  it('has route registered on profilesRouter', () => {
    const routerWithStack = profilesRouter as unknown as { stack: ExpressLayer[] };
    const stack = routerWithStack.stack;
    expect(stack).toBeDefined();
    const routes = stack
      .filter((layer): layer is ExpressLayer & { route: { path: string; methods: Record<string, boolean> } } => Boolean(layer.route))
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    expect(routes.some((r) => r.path === '/api/v1/profiles' && r.methods.includes('post'))).toBe(true);
    expect(routes.some((r) => r.path === '/profiles' && r.methods.includes('post'))).toBe(true);
  });
});
