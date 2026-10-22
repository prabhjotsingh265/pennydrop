import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 10;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Your name, please.').max(80),
  email: z.email('That doesn’t look like an email address.'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(128),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email('That doesn’t look like an email address.'),
  password: z.string().min(1, 'Your password, please.'),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** Who's signed in, and the workspace they're working in. */
export interface Me {
  /** `isAdmin`: sees the System page. */
  user: { id: string; name: string; email: string; isAdmin: boolean };
  workspace: {
    id: string;
    name: string;
    timezone: string;
    role: 'owner' | 'member';
    /** Quiet hours and the digest, as minutes after midnight in the workspace's zone. */
    quietFrom: number | null;
    quietUntil: number | null;
    digest: boolean;
    digestAt: number;
    /** A one-click demo, deleted when it expires. */
    isDemo: boolean;
    expiresAt: string | null;
  };
}
