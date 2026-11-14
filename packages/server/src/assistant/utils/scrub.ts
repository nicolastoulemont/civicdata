// Text that names or reaches a person: an email address, or a run of nine or
// more digits, such as a phone, card or account number, with up to two
// spaces, dots, dashes or brackets between digits. A run ending in 000 is a
// round figure, such as "1 000 000 000 people", and stays. A year or a range
// of years has fewer digits.
const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const number = /\+?\d(?:[ .()-]{0,2}\d){8,}/g

const isRound = (digits: string) => digits.endsWith("000")

// A question with every email address and long number replaced.
export const scrub = (question: string) =>
  question
    .replaceAll(email, "[email]")
    .replaceAll(number, (run) => (isRound(run) ? run : "[number]"))
