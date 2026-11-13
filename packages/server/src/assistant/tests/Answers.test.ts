import { describe, expect, it } from "@effect/vitest"

import { scrub } from "../Answers.ts"

describe("scrub", () => {
  it.each([
    ["Write to ana.r+gdp@example.co.uk about it", "Write to [email] about it"],
    ["Call me on +33 6 12 34 56 78", "Call me on [number]"],
    ["My number is 06.12.34.56.78", "My number is [number]"],
    ["Card 4111111111111111 was charged", "Card [number] was charged"],
    ["Is (555) 123-4567 American?", "Is ([number] American?"],
  ])("replaces what reaches a person in %j", (question, scrubbed) => {
    expect(scrub(question)).toBe(scrubbed)
  })

  it.each([
    "Unemployment in Spain from 2000 to 2024",
    "GDP per person, 1990-2023",
    "Countries with over 100000000 people",
    "Which has over 1 000 000 000 people?",
    "Which countries passed 1,000,000 migrants in 2015?",
    "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
  ])("keeps %j as asked", (question) => {
    expect(scrub(question)).toBe(question)
  })
})
