import { Rejection } from "@civicdata/domain"
import { Option } from "effect"
import { describe, expect, it } from "vitest"

import { unreadable } from "../src/readable.ts"

const { TooMany, TooFew } = Rejection.cases

describe("readable charts", () => {
  it("draws a trend of up to 6 countries", () => {
    expect(unreadable("trend", 6)).toEqual(Option.none())
    expect(unreadable("trend", 7)).toEqual(Option.some(TooMany.make({ most: 6 })))
  })

  it("draws a ranking or a change of up to 40 countries", () => {
    expect(unreadable("ranking", 40)).toEqual(Option.none())
    expect(unreadable("ranking", 41)).toEqual(Option.some(TooMany.make({ most: 40 })))
    expect(unreadable("change", 40)).toEqual(Option.none())
    expect(unreadable("change", 41)).toEqual(Option.some(TooMany.make({ most: 40 })))
  })

  it("draws a map of 10 countries or more", () => {
    expect(unreadable("map", 9)).toEqual(Option.some(TooFew.make({ least: 10 })))
    expect(unreadable("map", 10)).toEqual(Option.none())
  })

  it("draws a relation of 5 countries or more", () => {
    expect(unreadable("relation", 4)).toEqual(Option.some(TooFew.make({ least: 5 })))
    expect(unreadable("relation", 5)).toEqual(Option.none())
  })
})
