export interface Download {
  readonly bytes: Uint8Array
  readonly url: string
  // The page that named the PDF in its `citation_pdf_url` tag, when the
  // copy's PDF URL answered that page instead of a PDF.
  readonly landing: string | null
  readonly retrievedAt: string
}
