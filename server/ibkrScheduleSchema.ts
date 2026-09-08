import { z } from 'zod';

export const accountScheduleSchema = z.object({
  enabled: z.boolean(), mode: z.enum(['clock', 'market-close']),
  timeZone: z.enum(['Asia/Shanghai', 'America/New_York', 'UTC']),
  times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(12)
    .refine(times => new Set(times).size === times.length, '执行时间不能重复')
    .transform(times => [...times].sort()),
}).strict();
