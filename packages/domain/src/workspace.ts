import { z } from 'zod';

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const minutes = z.number().int().min(0).max(1_439);

export const updateWorkspaceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(60).optional(),
    /** An IANA zone such as Asia/Kolkata, for showing times and quiet hours. */
    timezone: z.string().max(64).refine(isTimeZone, 'Not a time zone we know.').optional(),
    /** Quiet hours and the daily digest, as minutes after midnight in the workspace's zone. */
    quietFrom: minutes.nullable().optional(),
    quietUntil: minutes.nullable().optional(),
    digest: z.boolean().optional(),
    digestAt: minutes.optional(),
  })
  // Quiet hours are set or cleared as a pair: half of them would mean none.
  .refine((w) => (w.quietFrom === undefined) === (w.quietUntil === undefined), {
    message: 'Give quiet hours a start and an end.',
    path: ['quietUntil'],
  })
  .refine((w) => (w.quietFrom === null) === (w.quietUntil === null), {
    message: 'Give quiet hours a start and an end.',
    path: ['quietUntil'],
  })
  .refine((w) => w.quietFrom == null || w.quietFrom !== w.quietUntil, {
    message: 'Quiet hours need to end at a different time from when they start.',
    path: ['quietUntil'],
  });
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;
