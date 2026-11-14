// The folder of every object the store writes, which names the format they
// hold. Bump its version when what an object holds changes, so a reader
// never decodes an object of another format, and the gather, which records
// each release under it, stores every series again.
export const layout = "series/v2"
