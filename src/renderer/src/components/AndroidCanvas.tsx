import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AndroidStreamClient,
  type AndroidStreamStatus,
} from '../androidStream';

export interface AndroidCanvasProps {
  wsUrl: string;
  screen: { width: number; height: number };
  onStatus?(s: AndroidStreamStatus, message?: string): void;
}

export function AndroidCanvas({ wsUrl, screen, onStatus }: AndroidCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<AndroidStreamClient | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);

  const [status, setStatus] = useState<AndroidStreamStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);

  // Check if WebCodecs VideoDecoder is available in this environment
  const isWebCodecsSupported =
    typeof window !== 'undefined' &&
    'VideoDecoder' in window &&
    typeof window.VideoDecoder === 'function';

  const handleStatusChange = useCallback((newStatus: AndroidStreamStatus, message?: string) => {
    setStatus(newStatus);
    if (newStatus === 'error') {
      setErrorMessage(message || 'Stream connection error');
    } else if (newStatus === 'closed') {
      setErrorMessage(message || 'Stream closed');
    } else {
      setErrorMessage(null);
    }
    onStatus?.(newStatus, message);
  }, [onStatus]);

  // Connect stream client and initialize VideoDecoder
  useEffect(() => {
    if (!isWebCodecsSupported) {
      handleStatusChange('error', 'WebCodecs VideoDecoder is unavailable in this environment');
      return undefined;
    }

    let isDisposed = false;

    // Create and configure WebCodecs VideoDecoder
    try {
      const decoder = new window.VideoDecoder({
        output: (frame: VideoFrame) => {
          try {
            if (isDisposed) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Draw frame onto screen-sized canvas
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          } finally {
            // CRITICAL: frame.close() in finally block to prevent decoder stall
            frame.close();
          }
        },
        error: (err: DOMException | Error) => {
          console.error('[AndroidCanvas] VideoDecoder error:', err);
          handleStatusChange('error', err.message);
        },
      });

      decoderRef.current = decoder;

      // Initial configuration for AVC/H.264
      try {
        decoder.configure({
          codec: 'avc1.42E01E',
          optimizeForLatency: true,
        });
      } catch (cfgErr) {
        console.warn('[AndroidCanvas] Initial configure warning:', cfgErr);
      }
    } catch (decoderInitErr) {
      console.error('[AndroidCanvas] Failed to construct VideoDecoder:', decoderInitErr);
      handleStatusChange('error', (decoderInitErr as Error).message);
      return undefined;
    }

    // Create stream client
    const client = new AndroidStreamClient(wsUrl, {
      onStatus: (newStatus, msg) => {
        if (!isDisposed) {
          handleStatusChange(newStatus, msg);
        }
      },
      onCodecMeta: (meta) => {
        if (isDisposed) return;
        const canvas = canvasRef.current;
        if (canvas && (canvas.width !== meta.width || canvas.height !== meta.height)) {
          canvas.width = meta.width;
          canvas.height = meta.height;
        }
      },
      onFrame: ({ data, isKeyFrame, pts, isConfig }) => {
        if (isDisposed) return;
        const decoder = decoderRef.current;
        if (!decoder || decoder.state === 'closed') return;

        if (isConfig) {
          // The CONFIG packet feeds decoder.configure({ codec, description: data })
          try {
            decoder.configure({
              codec: 'avc1.42E01E',
              description: data as unknown as BufferSource,
              optimizeForLatency: true,
            });
          } catch (cfgErr) {
            console.error('[AndroidCanvas] Failed to configure with CONFIG packet:', cfgErr);
          }
        } else {
          // Key and delta frames become EncodedVideoChunks with type 'key' | 'delta' and pts as timestamp
          try {
            const chunk = new window.EncodedVideoChunk({
              type: isKeyFrame ? 'key' : 'delta',
              timestamp: Number(pts),
              data: data as unknown as BufferSource,
            });
            decoder.decode(chunk);
          } catch (decErr) {
            console.error('[AndroidCanvas] Failed to decode chunk:', decErr);
          }
        }
      },
    });

    clientRef.current = client;
    client.setViewport(screen.width, screen.height);
    client.connect();

    return () => {
      isDisposed = true;
      if (decoderRef.current) {
        try {
          if (decoderRef.current.state !== 'closed') {
            decoderRef.current.close();
          }
        } catch {}
        decoderRef.current = null;
      }
      if (clientRef.current) {
        try {
          clientRef.current.close();
        } catch {}
        clientRef.current = null;
      }
    };
  }, [wsUrl, screen.width, screen.height, isWebCodecsSupported, handleStatusChange]);

  // ResizeObserver to track container/canvas viewport changes and notify server
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let lastW = 0;
    let lastH = 0;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const roundedW = Math.round(width);
      const roundedH = Math.round(height);

      if (roundedW > 0 && roundedH > 0 && (roundedW !== lastW || roundedH !== lastH)) {
        lastW = roundedW;
        lastH = roundedH;
        clientRef.current?.sendViewport(roundedW, roundedH);
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Pointer event handlers: scale coordinates from CSS pixels to guest screen size
  const getScaledCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return {
      x: Math.max(0, Math.min(canvas.width, Math.round(cssX * scaleX))),
      y: Math.max(0, Math.min(canvas.height, Math.round(cssY * scaleY))),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsPointerDown(true);
    const { x, y } = getScaledCoordinates(e);
    clientRef.current?.sendTouch(1, x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDown) return;
    e.preventDefault();
    const { x, y } = getScaledCoordinates(e);
    clientRef.current?.sendTouch(2, x, y);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDown) return;
    e.preventDefault();
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    setIsPointerDown(false);
    const { x, y } = getScaledCoordinates(e);
    clientRef.current?.sendTouch(0, x, y);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDown) return;
    e.preventDefault();
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    setIsPointerDown(false);
    const { x, y } = getScaledCoordinates(e);
    clientRef.current?.sendTouch(0, x, y);
  };

  // Wheel event handler: map to sendScroll
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const x = Math.max(0, Math.min(canvas.width, Math.round(cssX * scaleX)));
    const y = Math.max(0, Math.min(canvas.height, Math.round(cssY * scaleY)));

    clientRef.current?.sendScroll(x, y, Math.round(e.deltaX), Math.round(e.deltaY));
  };

  // If WebCodecs is unsupported, render clear, explicit notice
  if (!isWebCodecsSupported) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '36px 20px',
          gap: 12,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          textAlign: 'center',
          maxWidth: 480,
          margin: '24px auto',
        }}
      >
        <div style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          WebCodecs VideoDecoder Unavailable
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          The hardware-accelerated WebCodecs API is not supported or enabled in this browser environment.
          An H.264 compatible VideoDecoder is required to stream the Android emulator screen.
        </div>
      </div>
    );
  }

  const aspectRatio = `${screen.width} / ${screen.height}`;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        position: 'relative',
        background: 'var(--bg-app)',
        padding: '16px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Phone Frame with Letterboxed Canvas */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          aspectRatio,
          maxWidth: '100%',
          maxHeight: 'calc(100% - 56px)', // Leave room for bottom toolbar
          background: '#000000',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          width={screen.width}
          height={screen.height}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            touchAction: 'none',
            cursor: isPointerDown ? 'grabbing' : 'default',
          }}
        />

        {/* Status / Error Overlay */}
        {status !== 'streaming' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(9, 9, 11, 0.82)',
              backdropFilter: 'blur(4px)',
              padding: '20px',
              textAlign: 'center',
              gap: 12,
              zIndex: 10,
            }}
          >
            {status === 'connecting' && (
              <>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: '2px solid var(--divider)',
                    borderTopColor: 'var(--text)',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Connecting to Android stream...
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Awaiting H.264 video feed
                </div>
              </>
            )}

            {status === 'error' && (
              <>
                <div style={{ color: 'var(--danger)' }}>
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  Stream Error
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 300 }}>
                  {errorMessage || 'Failed to establish scrcpy video stream.'}
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => clientRef.current?.connect()}
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    padding: '6px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--control-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  Retry Connection
                </button>
              </>
            )}

            {status === 'closed' && (
              <>
                <div style={{ color: 'var(--text-muted)' }}>
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Stream Closed
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {errorMessage || 'The stream connection was closed.'}
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => clientRef.current?.connect()}
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    padding: '6px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--control-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Android Hardware Navigation Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          marginTop: 12,
          padding: '6px 14px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-full)',
          boxShadow: 'var(--shadow-sm)',
          zIndex: 5,
        }}
      >
        {/* Back (Key 4) */}
        <button
          type="button"
          onClick={() => clientRef.current?.sendKey(4)}
          title="Back (Keycode 4)"
          aria-label="Back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-full)',
            background: 'var(--control-bg)',
            border: '1px solid transparent',
            color: 'var(--text)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--control-bg)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polygon points="19,4 6,12 19,20" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {/* Home (Key 3) */}
        <button
          type="button"
          onClick={() => clientRef.current?.sendKey(3)}
          title="Home (Keycode 3)"
          aria-label="Home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-full)',
            background: 'var(--control-bg)',
            border: '1px solid transparent',
            color: 'var(--text)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--control-bg)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth={2.5} fill="none" />
          </svg>
        </button>

        {/* Recents (Key 187) */}
        <button
          type="button"
          onClick={() => clientRef.current?.sendKey(187)}
          title="Recents (Keycode 187)"
          aria-label="Recents"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-full)',
            background: 'var(--control-bg)',
            border: '1px solid transparent',
            color: 'var(--text)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--control-bg)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth={2.5} fill="none" />
          </svg>
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--divider)', margin: '0 2px' }} />

        {/* Power (Key 26) */}
        <button
          type="button"
          onClick={() => clientRef.current?.sendKey(26)}
          title="Power (Keycode 26)"
          aria-label="Power"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-full)',
            background: 'var(--control-bg)',
            border: '1px solid transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--control-bg)';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </button>

        {/* Rotate */}
        <button
          type="button"
          onClick={() => clientRef.current?.sendRotate()}
          title="Rotate Screen"
          aria-label="Rotate"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-full)',
            background: 'var(--control-bg)',
            border: '1px solid transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--control-bg)';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21.5 2v6h-6" />
            <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        </button>
      </div>
    </div>
  );
}
