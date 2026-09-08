import { motionSessions, MotionSessionError } from './session';

export interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface CdpDispatcher {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
}

/**
 * Handle incoming CDP messages for a profile.
 * Returns true if message was intercepted and handled as a Motion method, false otherwise.
 */
export async function handleMotionCdpMessage(
  profileId: string,
  message: unknown,
  dispatcher: CdpDispatcher,
  reply: (response: CdpResponse) => void
): Promise<boolean> {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const req = message as Partial<CdpRequest>;
  if (typeof req.id !== 'number' || typeof req.method !== 'string') {
    return false;
  }

  if (!req.method.startsWith('Motion.')) {
    return false;
  }

  const id = req.id;
  const method = req.method;
  const params = req.params || {};
  const sessionId = req.sessionId;

  try {
    switch (method) {
      case 'Motion.createPointer': {
        const seed = typeof params.seed === 'number' ? params.seed : undefined;
        const paceScale = typeof params.paceScale === 'number' ? params.paceScale : undefined;
        const profileSeed = typeof params.profileSeed === 'number' ? params.profileSeed : undefined;
        const startX = typeof params.startX === 'number' ? params.startX : undefined;
        const startY = typeof params.startY === 'number' ? params.startY : undefined;

        const pointer = motionSessions.createPointer(profileId, {
          seed,
          paceScale,
          profileSeed,
          startX,
          startY,
        });

        reply({
          id,
          result: {
            pointer: {
              x: pointer.x,
              y: pointer.y,
              seed: pointer.seed,
              paceScale: pointer.paceScale,
            },
          },
        });
        return true;
      }

      case 'Motion.glideTo': {
        const x = typeof params.x === 'number' ? params.x : 0;
        const y = typeof params.y === 'number' ? params.y : 0;
        const targetWidth = typeof params.targetWidth === 'number' ? params.targetWidth : 32;

        const { plan, pointer } = motionSessions.glideTo(profileId, { x, y }, targetWidth);

        // Dispatch CDP Input.dispatchMouseEvent for each trajectory step
        for (const move of plan.moves) {
          await dispatcher.send(
            'Input.dispatchMouseEvent',
            {
              type: 'mouseMoved',
              x: move.x,
              y: move.y,
            },
            sessionId
          );
        }

        reply({
          id,
          result: {
            x: pointer.x,
            y: pointer.y,
            durationMs: plan.durationMs,
            steps: plan.moves.length,
          },
        });
        return true;
      }

      case 'Motion.tap': {
        const clickCount = typeof params.clickCount === 'number' ? params.clickCount : 1;
        const button = params.button === 'right' || params.button === 'middle' ? params.button : 'left';
        const delayMs = typeof params.delayMs === 'number' ? params.delayMs : undefined;

        const tapResult = motionSessions.tap(profileId, { clickCount, button, delayMs });

        // Dispatch mousePressed and mouseReleased
        await dispatcher.send(
          'Input.dispatchMouseEvent',
          {
            type: 'mousePressed',
            x: tapResult.x,
            y: tapResult.y,
            button: tapResult.button,
            clickCount: tapResult.clicks,
          },
          sessionId
        );

        await dispatcher.send(
          'Input.dispatchMouseEvent',
          {
            type: 'mouseReleased',
            x: tapResult.x,
            y: tapResult.y,
            button: tapResult.button,
            clickCount: tapResult.clicks,
          },
          sessionId
        );

        reply({
          id,
          result: {
            tapped: true,
            x: tapResult.x,
            y: tapResult.y,
            clicks: tapResult.clicks,
          },
        });
        return true;
      }

      case 'Motion.enterText': {
        const text = typeof params.text === 'string' ? params.text : '';
        const allowTypos = Boolean(params.allowTypos);

        const { plan } = motionSessions.enterText(profileId, text, allowTypos);

        // Dispatch key events
        for (const keyAction of plan.keys) {
          const type = keyAction.type === 'down' ? 'keyDown' : 'keyUp';
          const isBackspace = keyAction.key === 'Backspace';

          const keyParams: Record<string, unknown> = {
            type,
            key: keyAction.key,
            code: isBackspace ? 'Backspace' : `Key${keyAction.key.toUpperCase()}`,
            windowsVirtualKeyCode: isBackspace ? 8 : keyAction.key.toUpperCase().charCodeAt(0),
          };

          if (!isBackspace && keyAction.type === 'down') {
            keyParams.text = keyAction.key;
          }

          await dispatcher.send('Input.dispatchKeyEvent', keyParams, sessionId);
        }

        reply({
          id,
          result: {
            entered: true,
            keyCount: plan.keys.length,
            durationMs: plan.durationMs,
          },
        });
        return true;
      }

      case 'Motion.destroyPointer': {
        motionSessions.destroyPointer(profileId);
        reply({
          id,
          result: { success: true },
        });
        return true;
      }

      default: {
        reply({
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
        return true;
      }
    }
  } catch (err) {
    if (err instanceof MotionSessionError) {
      reply({
        id,
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return true;
    }

    const message = err instanceof Error ? err.message : String(err);
    reply({
      id,
      error: {
        code: -32000,
        message,
      },
    });
    return true;
  }
}
