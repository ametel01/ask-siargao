const internalAuthFallbackEmailPattern =
  /^(?:unavailable|deleted)\+[^@\s]+@clerk\.ask-siargao\.local$/iu;

export function travelerEmailFromStoredEmail(email: string | null | undefined) {
  const trimmed = email?.trim();
  if (!trimmed || internalAuthFallbackEmailPattern.test(trimmed)) {
    return null;
  }

  return trimmed;
}
