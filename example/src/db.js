import { Db } from 'svouch'
import * as s from 'superstruct'

const db = Db({ name: 'fr.rixo.svouch.example', autoCommit: false })

export const todos = db
  .collection({
    name: 'todo',
    schema: s.object({
      text: s.string(),
    }),
  })
  .writable()
