// Vite imports a fixture's text with `?raw`, e.g. a recorded SDMX-CSV answer.
declare module "*?raw" {
  const text: string
  export default text
}
