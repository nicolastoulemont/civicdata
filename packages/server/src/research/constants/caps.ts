// The caps that stop a run. Past the cap on cached PDFs the run goes on,
// and a work that needs one waits for the next run.
export const caps = ["requests", "works", "pdfs", "bytes"] as const
