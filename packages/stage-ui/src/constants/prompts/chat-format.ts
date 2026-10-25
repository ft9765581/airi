/**
 * Format constraints the chat sends before every character prompt.
 *
 * They tell the model how this renderer reads code blocks and math, so they are
 * application-owned and never come from a character card. The medical
 * consultation branch sends them as well, which is why they live beside the
 * other prompt constants instead of inside the session store.
 */

// The language tag matters because the markdown renderer highlights by it.
const codeBlockConstraints = '- For any programming code block, always specify the programming language that supported on @shikijs/rehype on the rendered markdown, eg. ```python ... ```\n'

const mathConstraints = `${[
  '- Use $$...$$ for inline math.',
  '- Use a separate multiline $$ block for each display equation.',
  '- Use a latex fence for a list of independent one-line equations.',
  '- Use a math fence for one multiline equation or LaTeX environment.',
  '- Do not use single dollar signs as math delimiters.',
].join('\n')}\n`

/** The format constraints for one system message. */
export const chatFormatConstraints = codeBlockConstraints + mathConstraints
