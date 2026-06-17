import {
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments
} from '@chenglou/pretext';

export type FlowObstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
};

type Cursor = {
  segmentIndex: number;
  graphemeIndex: number;
};

type FlowBand = {
  x: number;
  width: number;
};

const START_CURSOR: Cursor = { segmentIndex: 0, graphemeIndex: 0 };

const resetCursor = (): Cursor => ({ ...START_CURSOR });

export function makePreparedFlowText(text: string, font: string, letterSpacing = 0) {
  return prepareWithSegments(text, font, {
    whiteSpace: 'normal',
    letterSpacing
  });
}

export function getObstacleBands(
  canvasWidth: number,
  y: number,
  lineHeight: number,
  obstacle: FlowObstacle,
  margin: number
): FlowBand[] {
  const top = obstacle.y - obstacle.padding;
  const bottom = obstacle.y + obstacle.height + obstacle.padding;
  const intersects = y + lineHeight > top && y < bottom;

  if (!intersects) {
    return [{ x: margin, width: Math.max(0, canvasWidth - margin * 2) }];
  }

  const leftEdge = obstacle.x - obstacle.padding;
  const rightEdge = obstacle.x + obstacle.width + obstacle.padding;
  const leftWidth = Math.max(0, leftEdge - margin);
  const rightX = Math.min(canvasWidth - margin, rightEdge);
  const rightWidth = Math.max(0, canvasWidth - margin - rightX);
  const bands: FlowBand[] = [];

  if (leftWidth > 92) bands.push({ x: margin, width: leftWidth });
  if (rightWidth > 92) bands.push({ x: rightX, width: rightWidth });

  return bands;
}

export function drawFlowRows({
  ctx,
  prepared,
  font,
  width,
  height,
  lineHeight,
  margin,
  obstacle,
  scroll,
  color
}: {
  ctx: CanvasRenderingContext2D;
  prepared: ReturnType<typeof prepareWithSegments>;
  font: string;
  width: number;
  height: number;
  lineHeight: number;
  margin: number;
  obstacle?: FlowObstacle | null;
  scroll: number;
  color: string;
}) {
  let cursor = resetCursor();
  let y = -((scroll % lineHeight) + lineHeight);
  ctx.font = font;
  ctx.fillStyle = color;

  while (y < height + lineHeight * 2) {
    const bands = obstacle
      ? getObstacleBands(width, y, lineHeight, obstacle, margin)
      : [{ x: margin, width: Math.max(0, width - margin * 2) }];

    for (let i = 0; i < bands.length; i += 1) {
      const band = bands[i];
      const range = layoutNextLineRange(prepared, cursor, band.width);
      const safeRange = range ?? layoutNextLineRange(prepared, resetCursor(), band.width);

      if (!safeRange) return;

      const line = materializeLineRange(prepared, safeRange);
      const sideBias = bands.length === 2 && i === 0 ? band.width - line.width : 0;
      const x = band.x + Math.max(0, sideBias);
      ctx.fillText(line.text, x, y);
      cursor = safeRange.end;
    }

    y += lineHeight;
  }
}
