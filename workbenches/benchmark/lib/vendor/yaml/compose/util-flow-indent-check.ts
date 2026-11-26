// @ts-nocheck
// Vendored from yaml (see lib/vendor/README.md): its authors type-check it, the host only compiles it.
import type { Token } from '../parse/cst.js'
import type { ComposeErrorHandler } from './composer.js'
import { containsNewline } from './util-contains-newline.js'

export function flowIndentCheck(
  indent: number,
  fc: Token | null | undefined,
  onError: ComposeErrorHandler
) {
  if (fc?.type === 'flow-collection') {
    const end = fc.end[0]
    if (
      end.indent === indent &&
      (end.source === ']' || end.source === '}') &&
      containsNewline(fc)
    ) {
      const msg = 'Flow end indicator should be more indented than parent'
      onError(end, 'BAD_INDENT', msg, true)
    }
  }
}
