import { handle } from "@civicdata/server"
import { createFileRoute } from "@tanstack/react-router"

// Throwaway probe for NTO-89: calls Eurostat or OECD from the deployed Worker
// and reports each answer's status, timing and rate-limit headers. Never merged.

const urls = {
  eurostat: (index: number) =>
    `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_a?geo=FR&geo=DE&age=Y15-74&unit=PC_ACT&sex=T&sinceTimePeriod=${2000 + (index % 25)}`,
  oecd: (index: number) =>
    `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/FRA+DEU........A?startPeriod=${2000 + (index % 25)}&dimensionAtObservation=AllDimensions`,
}

const headers = {
  eurostat: { accept: "application/json" },
  oecd: { accept: "application/vnd.sdmx.data+json; charset=utf-8; version=2.0" },
}

const kept = [
  "retry-after",
  "ratelimit",
  "ratelimit-policy",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "cf-cache-status",
  "cf-ray",
  "x-server-node",
  "age",
  "content-length",
]

const call = async (url: string, accept: Readonly<Record<string, string>>) => {
  const started = Date.now()

  try {
    const response = await fetch(url, { headers: accept })
    const body = await response.text()

    return {
      status: response.status,
      ms: Date.now() - started,
      bytes: body.length,
      headers: Object.fromEntries(
        kept.flatMap((name) => {
          const value = response.headers.get(name)

          return value === null ? [] : [[name, value]]
        }),
      ),
      body: response.ok ? undefined : body.slice(0, 300),
    }
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error) }
  }
}

const probe = async (request: Request) => {
  const query = new URL(request.url).searchParams
  const source = query.get("source") === "oecd" ? "oecd" : "eurostat"
  // Workers Free allows 50 subrequests per request; two go to the IP checks.
  const count = Math.min(45, Math.max(1, Number(query.get("n") ?? "5")))
  const same = query.get("same") === "1"
  const parallel = query.get("parallel") === "1"
  const offset = Number(query.get("offset") ?? "0")

  const targets = Array.from({ length: count }, (_, index) =>
    urls[source](same ? offset : offset + index),
  )

  const egress = await fetch("https://api.ipify.org?format=json")
    .then((response) => response.text())
    .catch(() => "unknown")

  const calls: Array<Awaited<ReturnType<typeof call>>> = []

  // Sequential calls measure a steady rate; parallel ones a burst.
  if (parallel) calls.push(...(await Promise.all(targets.map((url) => call(url, headers[source])))))
  // oxlint-disable-next-line no-await-in-loop
  else for (const url of targets) calls.push(await call(url, headers[source]))

  return Response.json({
    at: new Date().toISOString(),
    source,
    egress,
    colo: request.headers.get("cf-ray"),
    statuses: calls.map((each) => each.status),
    urls: targets,
    calls,
  })
}

// Every /api request goes to the Effect HttpApi, which owns routing and errors.
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        new URL(request.url).pathname === "/api/probe" ? probe(request) : handle(request),
    },
  },
})
