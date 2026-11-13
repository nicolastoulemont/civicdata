import { Paper, Year } from "@repo/domain"

export const paper = () =>
  Paper.make({
    id: "a".repeat(64),
    study: {
      authors: ["Example, Anne"],
      year: 2024,
      title: "Employment and training in France",
      publisher: "Example University",
      doi: "10.1234/training",
      url: "https://example.org/training.pdf",
    },
    population: "Working-age adults in France",
    quote: "Training participation was associated with higher employment.",
    kind: "Association",
    design: "Association",
    countries: ["FRA"],
    periods: [{ from: Year.make(2010), to: Year.make(2020) }],
    page: 4,
    url: "https://example.org/training.pdf#page=4",
    sha256: "b".repeat(64),
    version: "publishedVersion",
    licences: ["https://creativecommons.org/licenses/by/4.0/"],
    context: [
      { page: 5, text: "Selection into training may explain the association.", role: "Limitation" },
    ],
  })
