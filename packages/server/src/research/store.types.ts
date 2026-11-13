// Whether a copy's text may be stored and shown. Only an Admitted copy has
// versions. Withdrawn is a copy that was admitted until rights or a
// retraction removed its text.
export type Admission = "Admitted" | "Restricted" | "Retracted" | "Unidentified" | "Withdrawn"
