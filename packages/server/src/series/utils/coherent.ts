import type { IndicatorId, Qualification, Observation } from "@repo/domain"

const imfCoherent = (value: {
  readonly indicator?: { readonly id: IndicatorId }
  readonly version: string
  readonly observations: ReadonlyArray<Observation>
  readonly qualifications?: ReadonlyArray<Qualification>
}) =>
  value.indicator?.id !== "IMF:NGDP_RPCH" ||
  (value.observations.every((point) =>
    (value.qualifications ?? []).some(
      (item) =>
        item.source === "IMF" &&
        item.country === point.country &&
        item.year === point.year &&
        !item.missing &&
        value.version.startsWith(`${item.vintage}/`),
    ),
  ) &&
    (value.qualifications ?? []).every(
      (item) =>
        item.source === "IMF" &&
        item.missing ===
          !value.observations.some(
            (point) => point.country === item.country && point.year === item.year,
          ),
    ))

export const coherent = (value: {
  readonly indicator?: { readonly id: IndicatorId }
  readonly version: string
  readonly observations: ReadonlyArray<Observation>
  readonly qualifications?: ReadonlyArray<Qualification>
}) =>
  imfCoherent(value) &&
  (value.indicator?.id !== "V-Dem:v2x_polyarchy" ||
    value.observations.every((point) =>
      (value.qualifications ?? []).some(
        (item) =>
          item.source === "V-Dem" &&
          item.country === point.country &&
          item.year === point.year &&
          item.estimate === point.value,
      ),
    )) &&
  (value.qualifications ?? []).every(
    (item) =>
      item.source !== "V-Dem" ||
      (item.version === value.version &&
        (item.missing
          ? !value.observations.some(
              (point) => point.country === item.country && point.year === item.year,
            )
          : value.observations.some(
              (point) =>
                point.country === item.country &&
                point.year === item.year &&
                point.value === item.estimate,
            ))),
  )
