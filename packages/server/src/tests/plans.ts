import type { env } from "cloudflare:workers"
import { Effect } from "effect"

// A D1 database binding of the test Worker.
export type Database = NonNullable<typeof env.CATALOG_DB>

type Statement = ReturnType<Database["prepare"]>

// A statement a caller binds: its SQL and its values.
interface Bound {
  readonly query: string
  readonly values: ReadonlyArray<unknown>
  readonly statement: Statement
}

// `database`, telling `bound` of each statement a caller binds before it
// runs.
export const watched = (database: Database, bound: (read: Bound) => void): Database => {
  const watching = (query: string, statement: Statement) => {
    const bind = statement.bind.bind(statement)

    statement.bind = (...values) => {
      const read = bind(...values)

      bound({ query, values, statement: read })

      return read
    }

    return statement
  }

  return {
    prepare: (query) => watching(query, database.prepare(query)),
    batch: (statements) => database.batch(statements),
    exec: (query) => database.exec(query),
    withSession: (constraint) => database.withSession(constraint),
    dump: () => database.dump(),
  }
}

// `database` watched, and how SQLite plans each statement bound on it so
// far: the detail of each step of the statement's query plan.
export const plansOf = (database: Database) => {
  const bound: Array<Bound> = []
  const watching = watched(database, (each) => bound.push(each))

  const plans = Effect.forEach(bound, ({ query, values }) =>
    Effect.promise(() =>
      database
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...values)
        .all<{ detail: string }>(),
    ).pipe(Effect.map(({ results }) => ({ query, steps: results.map(({ detail }) => detail) }))),
  )

  return { database: watching, plans }
}
