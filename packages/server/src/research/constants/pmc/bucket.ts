// PubMed Central's copies, as PMC's article datasets on AWS serve them
// (https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/): a world-readable S3 bucket
// NCBI keeps for scripts, with no login. PMC's own article pages answer a
// script with a proof-of-work challenge, which the gather does not solve.
export const bucket = "pmc-oa-opendata.s3.amazonaws.com"
