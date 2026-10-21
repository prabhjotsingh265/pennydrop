import { z } from 'zod';

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export const updateWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  /** An IANA zone such as Asia/Kolkata, for showing times and, later, quiet hours. */
  timezone: z.string().max(64).refine(isTimeZone, 'Not a time zone we know.').optional(),
});
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;
