import { bucket } from "../constants/pmc/bucket.ts"
import type { Deposit } from "../pmc.schemas.ts"
import type { Article } from "../pmc.types.ts"

// The HTTPS address of a deposit's PDF, without the checksum its S3 URL
// carries, when the deposit is the one the copy names: a manuscript for an
// accepted version, the article otherwise.
export const pdfUrlOf = (deposit: typeof Deposit.Type, article: Article) =>
  deposit.pdf_url === null || deposit.is_manuscript !== article.manuscript
    ? undefined
    : `https://${bucket}/${deposit.pdf_url.slice("s3://pmc-oa-opendata/".length).split("?")[0]}`
