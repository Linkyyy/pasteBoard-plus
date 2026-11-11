import { describe, expect, it, vi } from 'vitest';
import { PopupSession } from '../electron/popup-session';
import { popupPosition, type Box } from '../shared/popup-position';
import type { FocusContext } from '../electron/windows-focus';

const target: FocusContext = { window: '812', control: '813', process: 1200, elementKey: '42-1-2', editable: true, caretLocated: true, x: 100, y: 472, width: 1, height: 20 };
const area = { x: 0, y: 0, width: 1920, height: 1080 };
function fixture(context: FocusContext | null = target) {
  let bounds: Box = { x: 0, y: 0, width: 1000, height: 800 };
  const host = { setBounds: vi.fn((next: Box) => { bounds = { ...next }; }), hide: vi.fn() };
  const placed = popupPosition(target, area, 400, 580);
  const session = new PopupSession(host, placed, context);
  return { session, host, placed, currentBounds: () => bounds, drag: (next: Box) => { bounds = next; } };
}

describe('a visible clipboard popup stays where it was opened', () => {
  it('ignores 1,000 alternating caret/control/missing-caret samples, including a screen-edge flip', () => {
    const { session, host, placed, currentBounds } = fixture();
    const samples = [
      { ...target, y: 473 }, // Old polling flips a 580px popup from below the caret to above it.
      { ...target, caretLocated: false, height: 2, y: 800 }, // Control fallback.
      { ...target, caretLocated: false, editable: false, width: 0, height: 0, x: 0, y: 0 },
      { ...target, x: 100.5, y: 471.5, height: 19.5 }, // Accessibility / DPI rounding.
    ];
    expect(popupPosition(samples[0], area, 400, 580)).not.toEqual(placed);
    for (let i = 0; i < 1000; i++) {
      expect(session.observe(samples[i % samples.length])).toBe(true);
      expect(currentBounds()).toEqual(placed);
    }
    expect(host.setBounds).toHaveBeenCalledExactlyOnceWith(placed, false);
    expect(host.hide).not.toHaveBeenCalled();
    expect(session.target).toEqual(target);
  });

  it('does not pull a manually dragged popup back to the original caret', () => {
    const { session, host, placed, drag, currentBounds } = fixture();
    const moved = { ...placed, x: 730, y: 40 };
    drag(moved);
    session.observe({ ...target, x: 900, y: 900 });
    expect(currentBounds()).toEqual(moved);
    expect(host.setBounds).toHaveBeenCalledTimes(1);
  });

  it.each([
    { window: '900' }, { control: '901' }, { process: 9999 }, { elementKey: '42-1-3' },
  ])('hides once if the original target changes: %j', change => {
    const { session, host } = fixture();
    expect(session.observe({ ...target, ...change })).toBe(false);
    session.observe(target);
    expect(host.hide).toHaveBeenCalledTimes(1);
    expect(host.setBounds).toHaveBeenCalledTimes(1);
  });

  it('ignores late observations after hiding or switching to management', () => {
    const { session, host } = fixture();
    session.end();
    expect(session.observe({ ...target, window: '900' })).toBe(false);
    expect(host.hide).not.toHaveBeenCalled();
    expect(host.setBounds).toHaveBeenCalledTimes(1);
  });

  it('takes a new position and target only when explicitly opened again', () => {
    const { session, host } = fixture();
    session.end();
    const nextTarget = { ...target, x: 1500, y: 850 };
    const bounds = popupPosition(nextTarget, area, 400, 580);
    const next = new PopupSession(host, bounds, nextTarget);
    session.observe({ ...target, window: '900' });
    next.observe({ ...nextTarget, y: 0, caretLocated: false });
    expect(host.setBounds).toHaveBeenLastCalledWith(bounds, false);
    expect(host.setBounds).toHaveBeenCalledTimes(2);
    expect(host.hide).not.toHaveBeenCalled();
  });

  it('snapshots the original paste target even if a capture object is later reused', () => {
    const captured = { ...target };
    const { session } = fixture(captured);
    captured.window = '900'; captured.y = 900;
    expect(session.target).toEqual(target);
  });
});
