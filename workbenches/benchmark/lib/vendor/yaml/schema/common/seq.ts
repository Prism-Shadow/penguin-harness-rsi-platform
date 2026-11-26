// @ts-nocheck
// Vendored from yaml (see lib/vendor/README.md): its authors type-check it, the host only compiles it.
import { isSeq } from '../../nodes/identity.js'
import { YAMLSeq } from '../../nodes/YAMLSeq.js'
import type { CollectionTag } from '../types.js'

export const seq: CollectionTag = {
  collection: 'seq',
  default: true,
  nodeClass: YAMLSeq,
  tag: 'tag:yaml.org,2002:seq',
  resolve(seq, onError) {
    if (!isSeq(seq)) onError('Expected a sequence for this tag')
    return seq
  },
  createNode: (schema, obj, ctx) => YAMLSeq.from(schema, obj, ctx)
}
