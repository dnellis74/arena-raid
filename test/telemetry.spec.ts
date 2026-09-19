import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLastDegradedReason,
  getTelemetryMode,
  resetTelemetry,
  setTelemetryMode,
  tickTelemetry,
} from '../src/net/telemetry.ts';

describe('telemetry degraded reason', () => {
  afterEach(() => {
    resetTelemetry();
    vi.restoreAllMocks();
  });

  it('warns once per distinct reason and shows reason on the 5s line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    setTelemetryMode('degraded', { reason: '?offline=1 / forceOffline' });
    expect(getTelemetryMode()).toBe('degraded');
    expect(getLastDegradedReason()).toBe('?offline=1 / forceOffline');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('[jev] degraded: ?offline=1 / forceOffline');

    // Same reason again — no second warn.
    setTelemetryMode('degraded', { reason: '?offline=1 / forceOffline' });
    expect(warn).toHaveBeenCalledTimes(1);

    // Distinct reason — warn once more and update stored reason.
    setTelemetryMode('degraded', { reason: 'no_TYPESAFE_API_KEY' });
    expect(getLastDegradedReason()).toBe('no_TYPESAFE_API_KEY');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toBe('[jev] degraded: no_TYPESAFE_API_KEY');

    tickTelemetry(1000); // arm the window clock
    const line = tickTelemetry(7000);
    expect(line).toContain('mode degraded (no_TYPESAFE_API_KEY)');
    expect(info).toHaveBeenCalled();
  });

  it('clears reason on live without a recovery log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    setTelemetryMode('degraded', { reason: 'no_TYPESAFE_API_KEY' });
    setTelemetryMode('live');
    expect(getTelemetryMode()).toBe('live');
    expect(getLastDegradedReason()).toBeNull();
    expect(info).not.toHaveBeenCalled();

    // Next degrade warns again.
    setTelemetryMode('degraded', { reason: 'no_TYPESAFE_API_KEY' });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
