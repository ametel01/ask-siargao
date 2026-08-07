export const clerkInstancePolicy = {
  allowedSignInMethods: ["email_code", "google_oauth"],
  emailVerificationRequired: true,
  maxSessionAgeDays: 7,
  multipleSessionsEnabled: false,
  operatorMfaRequired: true,
} as const;
