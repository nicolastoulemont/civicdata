import { describe, expect, it } from "@effect/vitest"
import { Failure, SourceUnavailable } from "@repo/domain"
import { Cause } from "effect"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"

import { failureOf } from "../src/Failure.ts"

const request = HttpClientRequest.get("https://api.worldbank.org/v2/en/indicator/SP.POP.TOTL")

const answered = (status: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
    }),
  })

const unanswered = (cause: unknown) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, cause }),
  })

describe("failureOf", () => {
  it("names the status category a source answered with", () => {
    expect(failureOf(answered(502))).toEqual(Failure.cases.ServerError.make({ status: 502 }))
    expect(failureOf(answered(429))).toEqual(Failure.cases.RateLimited.make({}))
    expect(failureOf(answered(404))).toEqual(Failure.cases.Refused.make({ status: 404 }))
  })

  it("tells a request that got no answer from one that timed out", () => {
    expect(failureOf(unanswered(new Error("connection reset")))).toEqual(
      Failure.cases.Transport.make({}),
    )
    expect(failureOf(unanswered(new Cause.TimeoutError()))).toEqual(Failure.cases.Timeout.make({}))
    expect(failureOf(new Cause.TimeoutError())).toEqual(Failure.cases.Timeout.make({}))
  })

  it("keeps an adapter's failure, and reads one without as unreadable", () => {
    const limited = new SourceUnavailable({
      source: "World Bank",
      failure: Failure.cases.RateLimited.make({}),
    })

    expect(failureOf(limited)).toEqual(Failure.cases.RateLimited.make({}))
    expect(failureOf(new SourceUnavailable({ source: "World Bank" }))).toEqual(
      Failure.cases.Unreadable.make({}),
    )
  })
})
