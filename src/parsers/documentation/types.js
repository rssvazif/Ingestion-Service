/**
 * Strongly-typed view of a parsed Markdown document. We keep the raw MDAST
 * tree alongside our derived structure so downstream chunkers can pick what
 * they need.
 *
 * @typedef {object} MarkdownHeading
 * @property {number} depth       1-based heading level (1 == "#", 2 == "##", ...).
 * @property {string} text        Plain text of the heading, code spans stripped.
 * @property {string} raw         Raw heading line as it appeared in source, including trailing newlines.
 * @property {number} startLine   1-based start line of the heading marker.
 * @property {number} endLine     1-based end line of the heading line itself.
 */

/**
 * @typedef {object} MarkdownCodeBlock
 * @property {string} [language] Language fence, e.g. ```ts — undefined if unspecified.
 * @property {string} value       Raw inner content of the code block, without the fences.
 * @property {number} startLine
 * @property {number} endLine
 */

/**
 * @typedef {object} MarkdownLink
 * @property {string} text
 * @property {string} url
 * @property {number} startLine
 */

/**
 * @typedef {object} ParsedDocumentation
 * @property {string} source
 * @property {MarkdownHeading[]} headings
 * @property {MarkdownCodeBlock[]} codeBlocks
 * @property {MarkdownLink[]} links
 * @property {import('mdast').Root} ast                  Full MDAST tree preserved for advanced consumers.
 * @property {Array<{ node: import('mdast').RootContent, startLine: number, endLine: number }>} topLevel
 */

/**
 * @typedef {object} MarkdownParserOptions
 * @property {number} [maxBytes] Maximum source size in bytes; oversized documents return an error.
 */