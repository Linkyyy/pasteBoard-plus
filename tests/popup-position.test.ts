import { expect, it } from 'vitest';
import { popupPosition } from '../shared/popup-position';
it('positions below the caret and flips above it near the bottom', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(popupPosition({ x: 100, y: 200, width: 2, height: 20 }, area, 400, 580)).toEqual({ x: 100, y: 228, width: 400, height: 580 });
  expect(popupPosition({ x: 1850, y: 980, width: 2, height: 20 }, area, 400, 580)).toEqual({ x: 1520, y: 392, width: 400, height: 580 });
});
it('keeps the popup on negative-coordinate monitors and small displays', () => {
  expect(popupPosition({ x: -20, y: 70, width: 1, height: 20 }, { x: -1920, y: 0, width: 1920, height: 1080 }, 400, 580)).toEqual({ x: -400, y: 98, width: 400, height: 580 });
  expect(popupPosition({ x: 900, y: 1000, width: 1, height: 20 }, { x: 0, y: 0, width: 320, height: 400 }, 400, 580)).toEqual({ x: 0, y: 0, width: 320, height: 400 });
});
