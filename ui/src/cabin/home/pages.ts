/** An app on Home takes this much room at least, page pixels: its column's width, and its row's parts (the icon, the
 * gap under it, the label's padding and its lines: home.css), and the gap between rows, narrowed to `minRowGap` at the
 * most to keep a row; and the same, compact (a short screen's: `.home-pages.compact`). The label's lines grow with the
 * text size, and the column with it at half that rate; a long name goes onto a second line (owner 2026-10-24: "App
 * labels can be 2 lines"). The icons stay as they are at any text size: they're seen, not read. */
export const CELL = { width: 220, icon: 138, gap: 14, labelPadding: 12, labelLine: 34, rowGap: 54, minRowGap: 20 }
export const COMPACT_CELL = { width: 136, icon: 84, gap: 8, labelPadding: 8, labelLine: 24, rowGap: 22, minRowGap: 12 }

type Cell = typeof CELL

/** The lines a label may take. */
export const LABEL_LINES = 2

/** A cell's height at `textScale`, its label `lines` long. */
export function cellHeight(cell: Cell, textScale: number, lines = 1): number {
  return Math.ceil(cell.icon + cell.gap + cell.labelPadding + cell.labelLine * lines * textScale)
}

/** A cell's width at `textScale`. */
function cellWidth(cell: Cell, textScale: number): number {
  return cell.width * (1 + (textScale - 1) / 2)
}

/**
 * How many apps a page of `width` x `height` holds at `textScale` (the player's Text Size): as many columns as fit (4
 * on the full 16:9 screen, 5 in the Scania Smart Dash's area at its scale) and as many rows of names of one line (2 on
 * either), never fewer than one each; `rowLayout` fits the names as they are into them. Compact where the full-size
 * cells don't fit two rows at the text as designed (the 7" Scania's screen, its UI scaled up: 4 x 2): by the screen
 * alone, never by the text, so a larger text never makes the icons smaller.
 */
export function pageSize(
  width: number,
  height: number,
  textScale = 1,
): { columns: number; rows: number; compact: boolean } {
  const compact = rowsOf(CELL, height, 1) < 2
  const cell = compact ? COMPACT_CELL : CELL
  return {
    columns: Math.max(1, Math.floor(width / cellWidth(cell, textScale))),
    rows: Math.max(1, rowsOf(cell, height, textScale)),
    compact,
  }
}

function rowsOf(cell: Cell, height: number, textScale: number): number {
  return Math.floor((height + cell.rowGap) / (cellHeight(cell, textScale) + cell.rowGap))
}

/**
 * The rows of Home's pages: how many (at most `rows`, as `pageSize` fits, and no more than the apps fill), each as tall
 * as the longest name in it on any page needs (`lines`: each app's label's lines, in Home's order), and the gap between
 * them, narrowed rather than a row fewer (a name of two lines in a row of `height` that held two rows of one). Every
 * page has the same rows.
 */
export function rowLayout(
  cell: Cell,
  textScale: number,
  height: number,
  columns: number,
  rows: number,
  lines: readonly number[],
): { rows: number; heights: number[]; gap: number } {
  for (let count = Math.max(1, Math.min(rows, Math.ceil(lines.length / columns))); ; count--) {
    const heights = Array.from({ length: count }, (_, row) => {
      let most = 1
      for (let start = row * columns; start < lines.length; start += count * columns) {
        for (const name of lines.slice(start, start + columns)) most = Math.max(most, name)
      }
      return cellHeight(cell, textScale, Math.min(LABEL_LINES, most))
    })
    const room = count > 1 ? (height - heights.reduce((sum, row) => sum + row, 0)) / (count - 1) : cell.rowGap
    if (count === 1 || room >= cell.minRowGap) {
      return { rows: count, heights, gap: Math.floor(Math.min(cell.rowGap, room)) }
    }
  }
}

/** An item on a page of Home's grid: its cell (column and row from 0) and how many it takes each way. */
export interface Placed<T> {
  item: T
  column: number
  row: number
  width: number
  height: number
}

/**
 * Home's items in pages of `columns` x `rows`, in order: each at the first place on the last page its cells fit
 * (taking a gap an earlier larger one left, as iOS's Home does), else on a new page; never on a page before it,
 * so the order holds from page to page. An item wider or taller than the page takes all of it that way. One
 * empty page without items.
 */
export function packPages<T>(
  items: readonly { item: T; width: number; height: number }[],
  columns: number,
  rows: number,
): Placed<T>[][] {
  const pages: { placed: Placed<T>[]; taken: boolean[] }[] = []
  const fits = (taken: boolean[], column: number, row: number, width: number, height: number) => {
    if (column + width > columns || row + height > rows) return false
    for (let r = row; r < row + height; r++) {
      for (let c = column; c < column + width; c++) if (taken[r * columns + c]) return false
    }
    return true
  }
  for (const { item, width: wanted, height: tall } of items) {
    const width = Math.max(1, Math.min(columns, wanted))
    const height = Math.max(1, Math.min(rows, tall))
    const place = (page: (typeof pages)[number]) => {
      for (let cell = 0; cell < columns * rows; cell++) {
        const column = cell % columns
        const row = Math.floor(cell / columns)
        if (!fits(page.taken, column, row, width, height)) continue
        for (let r = row; r < row + height; r++) {
          for (let c = column; c < column + width; c++) page.taken[r * columns + c] = true
        }
        page.placed.push({ item, column, row, width, height })
        return true
      }
      return false
    }
    const last = pages[pages.length - 1]
    if (last && place(last)) continue
    const page = { placed: [], taken: [] }
    pages.push(page)
    place(page)
  }
  return pages.length > 0 ? pages.map((page) => page.placed) : [[]]
}
