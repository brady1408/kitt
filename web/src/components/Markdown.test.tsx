import { test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

test('renders GFM tables and strikethrough', () => {
  const html = renderToStaticMarkup(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~'}</Markdown>)
  expect(html).toContain('<table>')
  expect(html).toContain('<td>2</td>')
  expect(html).toContain('<del>gone</del>')
})
