import { z } from 'zod';

/** Same rule as the branch code in the first-run form. */
export const BRANCH_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,7}$/, 'Use 2-8 capital letters or digits, starting with a letter');

const OWNER = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Lowercase letters, digits, dot, dash, underscore'),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(1).max(200),
});

/** "Create a new organisation" (the original first-run form). `isHeadOffice` is accepted but ignored: the first branch is always Head Office. */
export const CreateOrganisationBody = z.object({
  mode: z.literal('create').optional(),
  tenantName: z.string().trim().min(2).max(120),
  branchCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, 'Use 2-8 capital letters or digits, starting with a letter'),
  branchName: z.string().trim().min(2).max(120),
  isHeadOffice: z.boolean().optional(),
  admin: OWNER,
});

/** "Join an existing organisation" (a new branch PC). */
export const JoinOrganisationBody = z.object({
  mode: z.literal('join'),
  cloudUrl: z.string().trim().min(8).max(300),
  code: z.string().trim().min(4).max(80),
  admin: OWNER,
});

/** Head Office asks for an enrollment code for a new branch. */
export const EnrollmentCodeBody = z.object({
  code: BRANCH_CODE,
  name: z.string().trim().min(2).max(120),
});

export type JoinOrganisationInput = z.infer<typeof JoinOrganisationBody>;
