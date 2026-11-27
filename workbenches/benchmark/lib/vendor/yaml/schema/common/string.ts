// @ts-nocheck
// Vendored from yaml (see lib/vendor/README.md): its authors type-check it, the host only compiles it.
import { stringifyString } from '../../stringify/stringifyString.js'
import type { ScalarTag } from '../types.js'

export const string: ScalarTag = {
  identify: value => typeof value === 'string',
  default: true,
  tag: 'tag:yaml.org,2002:str',
  resolve: str => str,
  stringify(item, ctx, onComment, onChompKeep) {
    ctx = Object.assign({ actualString: true }, ctx)
    return stringifyString(item, ctx, onComment, onChompKeep)
  }
}
