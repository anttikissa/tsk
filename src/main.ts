import { main } from './cli.ts'

Promise.resolve()
  .then(() => main(process.argv.slice(2)))
  .then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
