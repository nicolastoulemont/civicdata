import { isRefusal } from "@repo/domain"
import { Cause, Exit, Match, Option, Tracer } from "effect"

// A span that ends refusing a View (isRefusal) ends as a success, with the
// refusal's tag as `openfacts.refusal`: the agent sends the call back to the
// model and the page asks the person to pick, so `status = error` keeps to
// what failed. Every other span ends as it would.
export const settled = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span: (options) => {
      const span = tracer.span(options)
      const end = span.end.bind(span)

      span.end = (endTime, exit) => {
        const refusal = Exit.isFailure(exit)
          ? Option.filter(Cause.findErrorOption(exit.cause), isRefusal)
          : Option.none()

        if (Option.isNone(refusal)) return end(endTime, exit)

        span.attribute(
          "openfacts.refusal",
          Match.valueTags(refusal.value, {
            IndicatorNotFound: () => "IndicatorNotFound",
            DimensionsMissing: () => "DimensionsMissing",
            TransformNotApplicable: () => "TransformNotApplicable",
          }),
        )
        end(endTime, Exit.void)
      }

      return span
    },
    context: tracer.context,
  })
