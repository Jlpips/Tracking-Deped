/**
 * Minimal chainable stand-in for `supabase.from(table)...` in page tests.
 * Every builder method is recorded and returns the builder; awaiting it resolves `respond(table, ops)`.
 */
export type Op = [method: string, ...args: unknown[]]
export interface QueryCall {
  table: string
  ops: Op[]
}
export interface QueryResult {
  data?: unknown
  error?: { message: string; code?: string } | null
  count?: number | null
}
export type Responder = (table: string, ops: Op[]) => QueryResult

export function makeSupabaseFake(respond: Responder = () => ({ data: [], error: null })) {
  const calls: QueryCall[] = []
  const state = { respond }

  function from(table: string) {
    const call: QueryCall = { table, ops: [] }
    calls.push(call)
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => ({ data: null, error: null, ...state.respond(table, call.ops) }))
                .then(resolve, reject)
          }
          return (...args: unknown[]) => {
            call.ops.push([String(prop), ...args])
            return builder
          }
        },
      },
    )
    return builder
  }

  return {
    client: { from },
    calls,
    setResponder(r: Responder) {
      state.respond = r
    },
    /** Calls on `table` whose ops include `method`. */
    find(table: string, method: string) {
      return calls.filter((c) => c.table === table && c.ops.some((o) => o[0] === method))
    },
  }
}

export const isMutation = (ops: Op[]) => ops.some((o) => ['insert', 'update', 'delete', 'upsert'].includes(o[0]))
