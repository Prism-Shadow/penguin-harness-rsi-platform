// @ts-nocheck
// Vendored from yaml (see lib/vendor/README.md): its authors type-check it, the host only compiles it.
export { Composer } from './compose/composer.js'

export { Document } from './doc/Document.js'
export { Schema } from './schema/Schema.js'

export type { ErrorCode } from './errors.js'
export { YAMLError, YAMLParseError, YAMLWarning } from './errors.js'

export { Alias } from './nodes/Alias.js'
export {
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq
} from './nodes/identity.js'
export type { Node, ParsedNode, Range } from './nodes/Node.js'
export { Pair } from './nodes/Pair.js'
export { Scalar } from './nodes/Scalar.js'
export { YAMLMap } from './nodes/YAMLMap.js'
export { YAMLSeq } from './nodes/YAMLSeq.js'

export type {
  CreateNodeOptions,
  DocumentOptions,
  ParseOptions,
  SchemaOptions,
  ToJSOptions,
  ToStringOptions
} from './options.js'

export * as CST from './parse/cst.js'
export { Lexer } from './parse/lexer.js'
export { LineCounter } from './parse/line-counter.js'
export { Parser } from './parse/parser.js'

export type { EmptyStream } from './public-api.js'
export {
  parse,
  parseAllDocuments,
  parseDocument,
  stringify
} from './public-api.js'

export type { TagId, Tags } from './schema/tags.js'
export type { CollectionTag, ScalarTag } from './schema/types.js'
export type { YAMLOMap } from './schema/yaml-1.1/omap.js'
export type { YAMLSet } from './schema/yaml-1.1/set.js'

export type {
  asyncVisitor,
  asyncVisitorFn,
  visitor,
  visitorFn
} from './visit.js'
export { visit, visitAsync } from './visit.js'
