export interface Box { x: number; y: number; width: number; height: number }
export function popupPosition(anchor: Box, area: Box, width: number, height: number): Box {
  width = Math.min(width, area.width); height = Math.min(height, area.height);
  const x = Math.max(area.x, Math.min(anchor.x, area.x + area.width - width));
  const below = anchor.y + anchor.height + 8;
  const above = anchor.y - height - 8;
  const y = Math.max(area.y, Math.min(below + height <= area.y + area.height ? below : above, area.y + area.height - height));
  return { x: Math.round(x), y: Math.round(y), width, height };
}
