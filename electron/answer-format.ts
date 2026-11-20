import { marked, type MarkedToken, type Token } from 'marked';

function renderText(tokens: Token[], separator = ''): string {
  return tokens.map((parsedToken, index) => {
    const token = parsedToken as MarkedToken;
    switch (token.type) {
      case 'space':
      case 'def':
      case 'hr':
        return '';
      case 'br':
        return '\n';
      case 'blockquote':
        return renderText(token.tokens, '\n\n');
      case 'heading':
      case 'paragraph':
      case 'del':
        return renderText(token.tokens);
      case 'strong':
      case 'em': {
        // Adjacent operands can use the same asterisks as emphasis.
        const before = tokens[index - 1]?.raw ?? '';
        const after = tokens[index + 1]?.raw ?? '';
        if (token.raw.startsWith('*') && /^[a-z\d_]+(?:\.\d+)?$/i.test(token.text)
          && /[\w)\]]$/.test(before) && /^[\w(\[]/.test(after)) return token.raw;
        return renderText(token.tokens);
      }
      case 'text':
        return token.tokens ? renderText(token.tokens) : token.text;
      case 'code':
      case 'codespan':
        return token.text;
      case 'link':
      case 'image': {
        const label = renderText(token.tokens);
        if ((token.type === 'link' && token.autolink) || label === token.href) return label;
        return label ? `${label} (${token.href})` : token.href;
      }
      case 'table':
        return [token.header, ...token.rows]
          .map(row => row.map(cell => renderText(cell.tokens)).join('\t'))
          .join('\n');
      case 'list':
        return token.items.map(item => {
          const number = token.ordered ? /^\s*(\d+)/.exec(item.raw)?.[1] : undefined;
          const prefix = number ? `${number}、` : '• ';
          const text = renderText(item.tokens, '\n').replace(/\n(?=[^\n])/g, '\n  ');
          return text.trim() ? `${prefix}${text}` : '';
        }).filter(Boolean).join('\n');
      case 'checkbox':
        return token.checked ? '☑ ' : '☐ ';
      default:
        return token.raw;
    }
  }).filter(Boolean).join(separator);
}

export function plainTextAnswer(text: string) {
  return renderText(marked.lexer(text), '\n\n');
}
