/**
 * @typedef {('class' | 'interface' | 'type' | 'enum' | 'function' | 'method' | 'variable')} CodeSymbolKind
 */

/**
 * @typedef {object} CodeChunk
 * @property {string} symbol                  Fully-qualified symbol name (e.g. "UserService.findUser").
 * @property {CodeSymbolKind} symbolType       Kind of the symbol the chunk represents.
 * @property {string} language                Programming language of the source chunk.
 * @property {number} startLine               1-based start line (inclusive of JSDoc when attached).
 * @property {number} endLine                 1-based end line.
 * @property {string} content                 Raw source content of the chunk (used later as RAG context).
 * @property {string} nodeType                Original code node the chunk was produced from.
 * @property {string} [parentSymbol]          Optional parent symbol for nested members (e.g. class name for methods).
 * @property {string} [signature]             Deterministic signature extracted from the source.
 * @property {string} [jsdoc]                 JSDoc comment directly attached to this symbol, when present.
 * @property {boolean} [exported]             Whether this declaration is exported from its module.
 */

/**
 * @typedef {object} CodeChunkerOptions
 * @property {boolean} [splitMethods]                      Include class methods as separate chunks.
 * @property {boolean} [includeLexicalDeclarations]        Include top-level lexical declarations (const/let) as chunks.
 * @property {boolean} [includeInterfaceMembers]           Include interface / type-alias members as separate chunks.
 * @property {boolean} [includeSemanticDeclarationsOnly]  When true (default) the chunker drops trivial lexical declarations
 *                                                          (require() calls, plain local values, simple assignments).
 * @property {boolean} [includeSemanticContextInContent]   When true (default) the chunker prepends a compact context block to
 *                                                          the chunk content.
 */