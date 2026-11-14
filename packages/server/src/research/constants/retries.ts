// Each stage retries a provider or store failure three times, 10, 20 and
// then 40 seconds apart. Invalid output does not throw, so it never retries.
export const retries = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} as const
