import type { DailyBriefChartPoint, DailyBriefEditorialSnapshot } from './dailyBriefTypes.ts';

export function hasBriefCryptoHistory(points?: DailyBriefChartPoint[], minimum = 31) {
  return Boolean(points && points.length >= minimum && points.every((point, index) =>
    Number.isFinite(point.value) && point.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(point.time)
    && Number.isFinite(Date.parse(point.time))
    && (index === 0 || Date.parse(point.time) - Date.parse(points[index - 1].time) === 86_400_000)));
}

export function hasBriefBtcTechnical(value?: DailyBriefEditorialSnapshot['btcTechnical']) {
  const level = (number: number | null) => number === null || Number.isFinite(number) && number > 0;
  return Boolean(value && value.lookbackDays >= 30 && Number.isFinite(value.atr14) && value.atr14 >= 0
    && Number.isFinite(Date.parse(value.calculatedAt)) && level(value.resistance) && level(value.supportLow) && level(value.supportHigh)
    && (value.supportLow === null && value.supportHigh === null
      || value.supportLow !== null && value.supportHigh !== null && value.supportLow <= value.supportHigh));
}
