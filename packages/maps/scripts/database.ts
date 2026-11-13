import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"

// Online source imports share DuckDB's setup and always release native resources.
export const withDatabase = async <A>(query: (connection: DuckDBConnection) => Promise<A>) => {
  const instance = await DuckDBInstance.create(":memory:", { threads: "4" })

  try {
    const connection = await instance.connect()

    try {
      await connection.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
      await connection.run("SET s3_region='us-west-2'")

      return await query(connection)
    } finally {
      connection.closeSync()
    }
  } finally {
    instance.closeSync()
  }
}
