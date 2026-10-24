// Deterministic provider output for routing tests; behavioral cases live in onboarding.test.ts.
export function onboardingFixture(system: string, messages: any[]) {
  if (!system.includes('You extract and validate business onboarding answers.')) return;
  const { field, answer } = JSON.parse(messages.at(-1).content);
  return { status: 'answered', updates: field === 'pricing' ? { offerings: answer, pricing: answer } : { [field]: answer } };
}
